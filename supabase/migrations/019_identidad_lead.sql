-- ============================================================
-- MIGRACIÓN 019: la puerta única de entrada del lead
--
-- POR QUÉ.
-- La auditoría contra el documento de arquitectura dio 145 requisitos sin
-- cumplir y 110 a medias. No son 255 problemas: son unos pocos, y la mayoría
-- cuelgan de éste.
--
-- Medido sobre la tabla el 14/09/2026, con 1.043 leads dentro:
--
--   Teléfonos distintos ...... 984
--   Teléfonos repetidos ......  44   ->  59 filas sobrantes
--   De ésos, cruzando canal ...   0
--
--   Formatos conviviendo en la columna `telefono`:
--     9 dígitos ....... 898      +34… ......  41
--     34… ..............  81      otro país    14      otro  9
--
-- Ningún duplicado cruzó de canal: cada puerta se duplica contra sí misma.
-- El motivo es el de arriba — `666111222`, `34666111222` y `+34666111222` son
-- la misma persona y tres filas distintas para Postgres. Con cuatro formatos
-- vivos no hay deduplicación posible, y por eso el CRM acabó buscando con
-- `.ilike` sobre el texto crudo.
--
-- La consecuencia que más duele: `interacciones` (018) está a CERO filas.
-- Cuando alguien escribe por segunda vez no se le añade una interacción al
-- historial, se le fabrica un lead nuevo. Así no hay cadencia de seguimiento
-- (sección 7), ni traspaso IA->agente decente (9), ni lead scoring (4): no se
-- puede puntuar a alguien que está partido en tres filas.
--
-- QUÉ HACE ESTA MIGRACIÓN.
--   1. Normaliza teléfono y email, y los mantiene normalizados solos.
--   2. Señala los duplicados que ya hay, SIN BORRAR NADA, y convierte esas 59
--      filas sobrantes en 59 interacciones reales sobre el contacto bueno.
--   3. Pone un índice único que impide que vuelva a pasar.
--   4. Deja una sola función de alta, `ingresar_lead()`, que es la puerta por
--      la que deberían entrar los cinco canales.
--
-- NO BORRA NI UNA FILA. Los duplicados quedan marcados con `duplicado_de`
-- apuntando al bueno; se deshace con un UPDATE si algo no cuadra.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Normalizar
--
-- E.164 ('+34666111222'), que es el formato que habla WhatsApp y el único que
-- permite comparar dos teléfonos con un `=`.
--
-- Se deja IMMUTABLE porque es pura: mismo texto, mismo resultado, siempre.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalizar_telefono(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  d text;
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;

  d := regexp_replace(t, '[^0-9]', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;

  -- Prefijo internacional escrito como 00: 0034... -> 34...
  IF left(d, 2) = '00' THEN
    d := substr(d, 3);
  END IF;

  -- Nueve dígitos empezando por 6/7 (móvil) u 8/9 (fijo) es España sin prefijo.
  -- Es el caso del 86% de la tabla.
  IF length(d) = 9 AND left(d, 1) IN ('6', '7', '8', '9') THEN
    d := '34' || d;
  END IF;

  -- Menos de nueve dígitos no es un teléfono: son extensiones, restos de
  -- copiar y pegar, o un campo que alguien rellenó a medias.
  IF length(d) < 9 THEN RETURN NULL; END IF;

  RETURN '+' || d;
END;
$fn$;

COMMENT ON FUNCTION public.normalizar_telefono(text) IS
  'Teléfono a E.164. Los de 9 dígitos se asumen españoles. NULL si no llega a teléfono.';


CREATE OR REPLACE FUNCTION public.normalizar_email(e text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT NULLIF(lower(btrim(e)), '');
$fn$;


-- ------------------------------------------------------------
-- 2. Las columnas que faltaban
--
-- Las de identidad (telefono_norm, email_norm, duplicado_de) y las de
-- atribución, que el documento pide en la sección 1 y hoy no existen: sin
-- ellas no se puede calcular el retorno de una campaña, y se están creando
-- campañas y adsets en Meta desde `My workflow 3`. Se gasta el dinero y no se
-- mide qué trajo.
--
-- `fuente` se queda como la FUENTE DE ADQUISICIÓN del documento: la del primer
-- contacto, inmutable. Los canales por los que vuelva después son interacciones
-- con su `canal`, no una fuente nueva. No hace falta columna aparte para eso
-- porque el contacto bueno es siempre el más antiguo (ver punto 5).
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS telefono_norm  text,
  ADD COLUMN IF NOT EXISTS email_norm     text,
  ADD COLUMN IF NOT EXISTS duplicado_de   uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Idempotencia: el id que trae el origen (Meta lead_id, id del formulario...).
  -- Sin esto, un reintento del webhook crea otro lead.
  ADD COLUMN IF NOT EXISTS external_id    text,

  -- `fuente` es POR DÓNDE se captó; `canal` es POR DÓNDE habla. Hoy están
  -- mezclados en la misma columna y por eso "Instagram" y "WhatsApp" compiten
  -- por el mismo hueco cuando en realidad son cosas distintas.
  ADD COLUMN IF NOT EXISTS canal          text,

  -- Referencia del inmueble. Hoy vive como subcadena dentro de `notas`, así que
  -- no se puede filtrar, ni agrupar, ni unir con nada.
  ADD COLUMN IF NOT EXISTS propiedad_ref  text,

  -- Los cinco UTM del documento. En columnas y no en un jsonb porque lo que se
  -- va a pedir es "cuántos leads trajo esta campaña", y eso es un GROUP BY.
  ADD COLUMN IF NOT EXISTS utm_source     text,
  ADD COLUMN IF NOT EXISTS utm_medium     text,
  ADD COLUMN IF NOT EXISTS utm_campaign   text,
  ADD COLUMN IF NOT EXISTS utm_content    text,
  ADD COLUMN IF NOT EXISTS utm_term       text,
  ADD COLUMN IF NOT EXISTS landing_url    text,

  -- RGPD. Hoy no hay rastro del consentimiento en ningún canal, ni columna ni
  -- payload. Con el scraper funcionando eso no es un detalle.
  ADD COLUMN IF NOT EXISTS consent_rgpd   boolean,
  ADD COLUMN IF NOT EXISTS consent_en     timestamptz,

  -- Cuándo entró de verdad, que no siempre es cuándo se guardó la fila: un
  -- email parseado el martes pudo llegar el viernes.
  ADD COLUMN IF NOT EXISTS recibido_en    timestamptz;


-- ------------------------------------------------------------
-- 3. Mantenerlas normalizadas sin que nadie se acuerde de hacerlo
--
-- Trigger y no columna generada a propósito: la normalización se va a querer
-- afinar (otros países, fijos raros), y con trigger basta con volver a lanzar
-- el UPDATE del punto 4; con una columna generada habría que tirarla y
-- recrearla.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_identidad_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.telefono_norm := public.normalizar_telefono(NEW.telefono);
  NEW.email_norm    := public.normalizar_email(NEW.email);
  IF NEW.recibido_en IS NULL THEN
    NEW.recibido_en := COALESCE(NEW.fecha_creacion, now());
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS leads_identidad ON public.leads;
CREATE TRIGGER leads_identidad
  BEFORE INSERT OR UPDATE OF telefono, email ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_identidad_lead();


-- ------------------------------------------------------------
-- 4. Poner al día lo que ya hay
-- ------------------------------------------------------------
UPDATE public.leads
SET telefono_norm = public.normalizar_telefono(telefono),
    email_norm    = public.normalizar_email(email),
    recibido_en   = COALESCE(recibido_en, fecha_creacion)
WHERE telefono_norm IS DISTINCT FROM public.normalizar_telefono(telefono)
   OR email_norm    IS DISTINCT FROM public.normalizar_email(email)
   OR recibido_en IS NULL;


-- ------------------------------------------------------------
-- 5. Señalar los duplicados
--
-- Gana el MÁS ANTIGUO, y no es un desempate arbitrario: el documento dice que
-- la fuente de adquisición es la del primer contacto y no cambia nunca. El
-- primero es, por definición, quien trajo a esta persona.
-- ------------------------------------------------------------
WITH ordenados AS (
  SELECT id,
         row_number() OVER (PARTITION BY telefono_norm
                            ORDER BY fecha_creacion ASC, id ASC) AS pos,
         first_value(id) OVER (PARTITION BY telefono_norm
                               ORDER BY fecha_creacion ASC, id ASC) AS canonico
  FROM public.leads
  WHERE telefono_norm IS NOT NULL
    AND duplicado_de IS NULL
)
UPDATE public.leads l
SET duplicado_de = o.canonico
FROM ordenados o
WHERE l.id = o.id
  AND o.pos > 1;


-- Rellenar en el bueno los huecos que sí traía el duplicado. Nunca pisa un dato
-- que ya estuviera puesto: sólo rellena vacíos.
UPDATE public.leads bueno
SET nombre    = COALESCE(NULLIF(bueno.nombre, ''),    NULLIF(d.nombre, '')),
    apellidos = COALESCE(NULLIF(bueno.apellidos, ''), NULLIF(d.apellidos, '')),
    email     = COALESCE(NULLIF(bueno.email, ''),     NULLIF(d.email, ''))
FROM public.leads d
WHERE d.duplicado_de = bueno.id
  AND (bueno.nombre IS NULL OR bueno.nombre = ''
    OR bueno.apellidos IS NULL OR bueno.apellidos = ''
    OR bueno.email IS NULL OR bueno.email = '');


-- ------------------------------------------------------------
-- 6. Convertir las filas sobrantes en historial de verdad
--
-- Esto es lo que las hace dejar de ser basura: cada duplicado era una persona
-- volviendo a escribir, y eso es exactamente una interacción. En vez de
-- perderlo al deduplicar, se gana: 59 interacciones que antes no existían.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema)
VALUES ('tipo_interaccion', 'reentrada', 'Volvió a entrar', 'orange', 15, true, true)
ON CONFLICT (tipo, valor) DO NOTHING;

INSERT INTO public.interacciones
  (lead_id, tipo, direccion, canal, resumen, detalle, automatica, ocurrida_en, meta)
SELECT d.duplicado_de,
       'reentrada',
       'entrante',
       NULL,
       'Volvió a entrar por ' || COALESCE(NULLIF(d.fuente, ''), 'origen desconocido'),
       NULLIF(d.notas, ''),
       true,
       d.fecha_creacion,
       jsonb_build_object('lead_duplicado', d.id, 'migracion', '019')
FROM public.leads d
WHERE d.duplicado_de IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.interacciones i
    WHERE i.meta ->> 'lead_duplicado' = d.id::text
  );


-- ------------------------------------------------------------
-- 7. Llevarse lo que colgaba del duplicado al contacto bueno
--
-- Si no, una visita agendada sobre la fila sobrante desaparece de la ficha en
-- cuanto se deje de enseñar a los duplicados.
-- ------------------------------------------------------------
UPDATE public.agenda a
SET lead_id = d.duplicado_de
FROM public.leads d
WHERE a.lead_id = d.id AND d.duplicado_de IS NOT NULL;

UPDATE public.interacciones i
SET lead_id = d.duplicado_de
FROM public.leads d
WHERE i.lead_id = d.id
  AND d.duplicado_de IS NOT NULL
  AND i.meta ->> 'migracion' IS DISTINCT FROM '019';

-- Las etiquetas pueden chocar (el bueno ya tiene la misma), así que se tiran
-- las repetidas y se mueven las que no lo son.
DELETE FROM public.lead_etiquetas le
USING public.leads d
WHERE le.lead_id = d.id
  AND d.duplicado_de IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.lead_etiquetas otra
    WHERE otra.lead_id = d.duplicado_de AND otra.etiqueta = le.etiqueta
  );

UPDATE public.lead_etiquetas le
SET lead_id = d.duplicado_de
FROM public.leads d
WHERE le.lead_id = d.id AND d.duplicado_de IS NOT NULL;


-- ------------------------------------------------------------
-- 8. Que no vuelva a pasar
--
-- Índice único PARCIAL: sólo sobre los contactos vivos. Los marcados como
-- duplicado quedan fuera, que es lo que permite conservarlos sin que estorben.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS leads_telefono_norm_uq
  ON public.leads (telefono_norm)
  WHERE duplicado_de IS NULL AND telefono_norm IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_external_id_uq
  ON public.leads (fuente, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_email_norm_idx
  ON public.leads (email_norm) WHERE email_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_duplicado_idx
  ON public.leads (duplicado_de) WHERE duplicado_de IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_campana_idx
  ON public.leads (utm_campaign) WHERE utm_campaign IS NOT NULL;


-- ------------------------------------------------------------
-- 9. La puerta
--
-- Una sola función de alta para los cinco canales. Hace, en este orden, lo que
-- el documento pide como pipeline de ingestión y que hoy no hace nadie:
--   normalizar -> buscar duplicado -> actualizar o crear -> atribuir -> interacción
--
-- Devuelve jsonb con el id, si se creó o se reusó, y por qué. Los workflows de
-- n8n pueden mirar `creado` para decidir si mandan el mensaje de bienvenida:
-- hoy se lo mandan otra vez a quien ya lo recibió.
--
-- SECURITY DEFINER porque tiene que poder mirar TODA la tabla para deduplicar,
-- aunque quien llame sea un rol que sólo ve lo suyo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingresar_lead(
  p_telefono      text,
  p_fuente        text,
  p_nombre        text DEFAULT NULL,
  p_apellidos     text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_canal         text DEFAULT NULL,
  p_notas         text DEFAULT NULL,
  p_external_id   text DEFAULT NULL,
  p_propiedad_ref text DEFAULT NULL,
  p_landing_url   text DEFAULT NULL,
  p_utm           jsonb DEFAULT NULL,
  p_consent       boolean DEFAULT NULL,
  p_resumen       text DEFAULT NULL,
  p_recibido_en   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tel    text := public.normalizar_telefono(p_telefono);
  v_email  text := public.normalizar_email(p_email);
  v_id     uuid;
  v_creado boolean := false;
  v_motivo text;
BEGIN
  IF v_tel IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'ingresar_lead: hace falta al menos un teléfono o un email válidos (recibido: %)', p_telefono;
  END IF;

  -- a) Por external_id, que es la idempotencia de verdad: el reintento de un
  --    webhook trae el mismo id y no debe crear nada.
  IF p_external_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads
    WHERE fuente = p_fuente AND external_id = p_external_id
    LIMIT 1;
    IF v_id IS NOT NULL THEN v_motivo := 'external_id'; END IF;
  END IF;

  -- b) Por teléfono normalizado.
  IF v_id IS NULL AND v_tel IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads
    WHERE telefono_norm = v_tel AND duplicado_de IS NULL
    ORDER BY fecha_creacion ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_motivo := 'telefono'; END IF;
  END IF;

  -- c) Por email, para los canales que no traen teléfono.
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_id FROM public.leads
    WHERE email_norm = v_email AND duplicado_de IS NULL
    ORDER BY fecha_creacion ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_motivo := 'email'; END IF;
  END IF;

  IF v_id IS NULL THEN
    -- Contacto nuevo.
    INSERT INTO public.leads (
      nombre, apellidos, email, telefono, fuente, canal, notas,
      external_id, propiedad_ref, landing_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      consent_rgpd, consent_en, recibido_en
    ) VALUES (
      NULLIF(p_nombre, ''), NULLIF(p_apellidos, ''), NULLIF(p_email, ''),
      p_telefono, p_fuente, p_canal, NULLIF(p_notas, ''),
      p_external_id, p_propiedad_ref, p_landing_url,
      p_utm ->> 'utm_source', p_utm ->> 'utm_medium', p_utm ->> 'utm_campaign',
      p_utm ->> 'utm_content', p_utm ->> 'utm_term',
      p_consent,
      CASE WHEN p_consent THEN COALESCE(p_recibido_en, now()) END,
      COALESCE(p_recibido_en, now())
    )
    RETURNING id INTO v_id;

    v_creado := true;
    v_motivo := 'nuevo';
  ELSE
    -- Ya existía: se RELLENAN huecos, nunca se pisa lo que ya hay. Lo que la
    -- landing hace hoy es lo contrario — sobrescribe `notas` entera en el
    -- paso 3 y se lleva por delante lo que hubiera escrito un agente.
    UPDATE public.leads SET
      nombre        = COALESCE(NULLIF(nombre, ''),    NULLIF(p_nombre, '')),
      apellidos     = COALESCE(NULLIF(apellidos, ''), NULLIF(p_apellidos, '')),
      email         = COALESCE(NULLIF(email, ''),     NULLIF(p_email, '')),
      telefono      = COALESCE(NULLIF(telefono, ''),  NULLIF(p_telefono, '')),
      propiedad_ref = COALESCE(propiedad_ref, p_propiedad_ref),
      external_id   = COALESCE(external_id, p_external_id),
      consent_rgpd  = COALESCE(consent_rgpd, p_consent),
      consent_en    = COALESCE(consent_en, CASE WHEN p_consent THEN now() END)
    WHERE id = v_id;
  END IF;

  -- La interacción se escribe SIEMPRE, se haya creado o no. Es lo que hace que
  -- la segunda vez que alguien escribe quede registrada en vez de convertirse
  -- en otra fila.
  INSERT INTO public.interacciones
    (lead_id, tipo, direccion, canal, resumen, detalle, automatica, ocurrida_en, meta)
  VALUES (
    v_id,
    CASE WHEN v_creado THEN 'formulario' ELSE 'reentrada' END,
    'entrante',
    p_canal,
    COALESCE(
      NULLIF(p_resumen, ''),
      CASE WHEN v_creado
           THEN 'Entró por ' || COALESCE(p_fuente, 'origen desconocido')
           ELSE 'Volvió a entrar por ' || COALESCE(p_fuente, 'origen desconocido')
      END
    ),
    NULLIF(p_notas, ''),
    true,
    COALESCE(p_recibido_en, now()),
    jsonb_build_object('fuente', p_fuente, 'motivo_match', v_motivo, 'utm', p_utm)
  );

  RETURN jsonb_build_object(
    'lead_id', v_id,
    'creado',  v_creado,
    'motivo',  v_motivo
  );
END;
$fn$;

COMMENT ON FUNCTION public.ingresar_lead IS
  'Puerta única de alta de leads: normaliza, deduplica, crea o actualiza, atribuye y deja interacción. Devuelve {lead_id, creado, motivo}.';


-- ------------------------------------------------------------
-- 10. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Cuántos quedan sin normalizar (deberían ser 0 o muy pocos):
--   SELECT count(*) FILTER (WHERE telefono_norm IS NULL) AS sin_normalizar,
--          count(*) FILTER (WHERE telefono_norm IS NOT NULL) AS normalizados
--   FROM public.leads;
--
--   -- Los 59 duplicados, marcados y con su interacción:
--   SELECT count(*) AS duplicados FROM public.leads WHERE duplicado_de IS NOT NULL;
--   SELECT count(*) AS reentradas FROM public.interacciones WHERE tipo = 'reentrada';
--
--   -- Que el índice único hace su trabajo (debe fallar con duplicate key):
--   --   INSERT INTO public.leads (nombre, telefono, fuente, estado)
--   --   VALUES ('Duplicado de prueba', (SELECT telefono FROM public.leads
--   --           WHERE duplicado_de IS NULL AND telefono_norm IS NOT NULL LIMIT 1),
--   --           'Web', 'Nuevo');
--
--   -- Y deshacer el marcado, si hiciera falta:
--   --   UPDATE public.leads SET duplicado_de = NULL WHERE duplicado_de IS NOT NULL;
