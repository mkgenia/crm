-- ============================================================
-- MIGRACIÓN 022: prospectos, contactos, y el salto desde la captación
--
-- QUÉ ES UN PROSPECTO. Una captación es un anuncio de Idealista que el scraper
-- ha traído. Un prospecto es lo que empieza cuando el propietario dice que sí:
-- ya no es un anuncio ajeno, es un piso que estamos captando nosotros.
--
-- UNA SOLA TABLA NUEVA. `contactos` no es una tabla: es una vista sobre `leads`.
-- Crear una tabla de contactos significaría una segunda noción de identidad
-- encima de la que montó la 019 (teléfono normalizado, índice, duplicado_de), y
-- dos nociones de identidad siempre acaban discrepando. El contacto ES el lead
-- canónico, sólo que mirado desde otro sitio.
--
-- POR QUÉ EL PROSPECTO ES UNA TABLA Y NO UNA COLUMNA EN `captaciones`:
--   1. `captaciones.id` ES el id del anuncio de Idealista. Un prospecto dado de
--      alta a mano —un propietario que entra por la puerta— tendría que
--      inventarse un bigint que algún día chocará con un anuncio real.
--   2. El scraper pisa `captaciones` en cada pasada: precio, imágenes,
--      raw_data, activo. "Que sea editable su información" no puede vivir ahí,
--      porque el siguiente barrido se lo lleva. Por eso la ficha se COPIA.
--
-- DE MOMENTO SÓLO PROSPECTO. El salto directo a propiedad se queda fuera a
-- propósito: la cartera llega del XML de Inmovilla y el CRM no puede inventarse
-- una referencia. Si creáramos un borrador con una ref falsa, el día que
-- Inmovilla publique el piso de verdad traería otra y tendrías el mismo
-- inmueble dos veces en la cartera y en /matches. Las columnas `propiedad_ref`
-- y `captada_en` sí existen ya, para poder cerrar el prospecto cuando la
-- referencia buena aparezca.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El embudo del prospecto, al catálogo
--
-- Se siembra ANTES de la tabla porque el DEFAULT 'Nuevo' pasa por el trigger de
-- validación de la 012.
--
-- Sólo TRES nacen activos. Los otros tres entran desactivados: así no aparecen
-- como columnas vacías en el tablero, pero se encienden con un clic desde
-- /configuracion/catalogos el día que alguien los pida. Sembrarlos todos activos
-- daría seis columnas con todo amontonado en la primera — que es exactamente lo
-- que le pasa hoy a `estado_crm`, donde 608 de 737 están en "Contactado" y
-- "Negociación" y "Ganado" no las ha usado nadie jamás.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema) VALUES
  ('estado_prospecto', 'Nuevo',      'Nuevo',      'slate',   10, true,  true),
  ('estado_prospecto', 'Captado',    'Captado',    'emerald', 50, true,  true),
  ('estado_prospecto', 'Perdido',    'Perdido',    'rose',    60, true,  true),

  ('estado_prospecto', 'Valorando',  'Valorando',  'sky',     20, false, false),
  ('estado_prospecto', 'Propuesta',  'Propuesta',  'indigo',  30, false, false),
  ('estado_prospecto', 'Negociando', 'Negociando', 'amber',   40, false, false)
ON CONFLICT (tipo, valor) DO NOTHING;


-- ------------------------------------------------------------
-- 2. Prospectos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- QUIÉN. Siempre el contacto canónico: lo garantiza promocionar_captacion(),
  -- que resuelve COALESCE(duplicado_de, id) antes de enlazar.
  contacto_id  uuid   NOT NULL REFERENCES public.leads(id)       ON DELETE RESTRICT,
  -- DE DÓNDE salió. El borrado de la captación además queda bloqueado (punto 7).
  captacion_id bigint          REFERENCES public.captaciones(id) ON DELETE SET NULL,

  -- DOS personas, y es deliberado:
  --   captado_por -> quién lo trajo. Se congela aquí y no se toca nunca más.
  --   agente_id   -> quién lo trabaja hoy. Se traspasa.
  -- Hoy `captaciones.agente_id` es las dos cosas a la vez, y por eso cada
  -- traspaso borra al captador. "Captado por Raúl" no se puede sostener sin
  -- separarlos.
  captado_por uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  agente_id   uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  creado_por  uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,

  estado         text NOT NULL DEFAULT 'Nuevo',
  motivo_perdida text,
  perdido_en     timestamptz,

  -- LA COPIA EDITABLE de la ficha, congelada en el momento del salto.
  direccion       text,
  barrio          text,
  ciudad          text NOT NULL DEFAULT 'Valencia',
  tipo_inmueble   text,
  operacion       text,
  precio          numeric,   -- lo que pide el propietario
  precio_salida   numeric,   -- lo que se acuerda para publicar
  metros          integer,
  habitaciones    integer,
  banos           integer,
  planta          text,
  tiene_ascensor  boolean,
  estado_inmueble text,      -- "Buen estado" / "A reformar"
  descripcion     text,
  imagenes        text[],
  url_anuncio     text,
  exclusiva       boolean,
  honorarios_pct  numeric,

  -- El día del comercial, igual que en captaciones (021).
  atendido_en    timestamptz,
  atendido_por   uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  proximo_toque  timestamptz,
  proximo_motivo text,

  -- EL CIERRE. Texto y no clave ajena: la propiedad la publica Inmovilla y su
  -- XML puede tardar días. Una FK obligaría a esperar para poder cerrar.
  propiedad_ref text,
  captada_en    timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- La idempotencia del salto vive aquí y no en el navegador: dos clics a la vez
-- son dos peticiones, y sin esto serían dos prospectos del mismo piso.
CREATE UNIQUE INDEX IF NOT EXISTS prospectos_captacion_uidx
  ON public.prospectos (captacion_id) WHERE captacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospectos_contacto_idx ON public.prospectos (contacto_id);
CREATE INDEX IF NOT EXISTS prospectos_agente_idx   ON public.prospectos (agente_id, proximo_toque);
CREATE INDEX IF NOT EXISTS prospectos_estado_idx   ON public.prospectos (estado, updated_at DESC);

-- RLS CON política desde el primer día. La 016 explica qué pasa si no: `agenda`
-- y `catalogos` nacieron con RLS y sin política, y dieron dos pantallas en
-- blanco devolviendo 200 OK y cero filas durante días sin un solo error.
ALTER TABLE public.prospectos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospectos_lectura ON public.prospectos;
CREATE POLICY prospectos_lectura ON public.prospectos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS prospectos_escritura ON public.prospectos;
CREATE POLICY prospectos_escritura ON public.prospectos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Validación contra el catálogo, como el resto de estados (012).
DROP TRIGGER IF EXISTS prospectos_estado_cat ON public.prospectos;
CREATE TRIGGER prospectos_estado_cat
  BEFORE INSERT OR UPDATE OF estado ON public.prospectos
  FOR EACH ROW EXECUTE FUNCTION public.validar_contra_catalogo('estado_prospecto', 'estado');


-- ------------------------------------------------------------
-- 3. Las columnas que enlazan lo que ya existía
-- ------------------------------------------------------------
ALTER TABLE public.captaciones
  ADD COLUMN IF NOT EXISTS prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE SET NULL;

ALTER TABLE public.interacciones
  ADD COLUMN IF NOT EXISTS prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE CASCADE;

ALTER TABLE public.agenda
  ADD COLUMN IF NOT EXISTS prospecto_id uuid REFERENCES public.prospectos(id) ON DELETE SET NULL;

-- Cuándo un lead dejó de ser un lead y pasó a ser un contacto con el que se
-- trabaja. Es lo único que distingue una cosa de la otra.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contacto_desde timestamptz;

CREATE INDEX IF NOT EXISTS interacciones_prospecto_idx
  ON public.interacciones (prospecto_id, ocurrida_en DESC) WHERE prospecto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_prospecto_idx
  ON public.agenda (prospecto_id) WHERE prospecto_id IS NOT NULL;

-- La restricción de la 018 exigía lead o captación. Ahora también vale un
-- prospecto: una nota sobre un piso que ya se está captando cuelga de él.
ALTER TABLE public.interacciones DROP CONSTRAINT IF EXISTS interacciones_tiene_dueno;
ALTER TABLE public.interacciones ADD CONSTRAINT interacciones_tiene_dueno
  CHECK (lead_id IS NOT NULL OR captacion_id IS NOT NULL OR prospecto_id IS NOT NULL);


-- ------------------------------------------------------------
-- 4. El sello de atención, ahora también para prospectos
--    (reemplaza la versión de la 021, sin cambiar la firma)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_atencion()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.automatica OR NEW.tipo NOT IN ('atendido', 'llamada', 'visita') THEN
    RETURN NULL;
  END IF;

  IF NEW.captacion_id IS NOT NULL THEN
    UPDATE public.captaciones
       SET atendido_en  = GREATEST(COALESCE(atendido_en, NEW.ocurrida_en), NEW.ocurrida_en),
           atendido_por = COALESCE(NEW.agente_id, atendido_por)
     WHERE id = NEW.captacion_id;
  END IF;

  IF NEW.prospecto_id IS NOT NULL THEN
    UPDATE public.prospectos
       SET atendido_en  = GREATEST(COALESCE(atendido_en, NEW.ocurrida_en), NEW.ocurrida_en),
           atendido_por = COALESCE(NEW.agente_id, atendido_por)
     WHERE id = NEW.prospecto_id;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET atendido_en  = GREATEST(COALESCE(atendido_en, NEW.ocurrida_en), NEW.ocurrida_en),
           atendido_por = COALESCE(NEW.agente_id, atendido_por)
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NULL;
END;
$fn$;


-- ------------------------------------------------------------
-- 5. El próximo toque se calcula solo desde la agenda
--
-- Sin esto, `proximo_toque` sólo se escribía al atender. Si alguien mueve o
-- completa un recordatorio desde el calendario, la lista del comercial seguiría
-- diciendo la fecha vieja — y una lista que miente sobre a quién hay que llamar
-- hoy deja de abrirse a la semana.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_proximo_toque()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_cap  bigint := COALESCE(NEW.captacion_id, OLD.captacion_id);
  v_lead uuid   := COALESCE(NEW.lead_id,      OLD.lead_id);
  v_pro  uuid   := COALESCE(NEW.prospecto_id, OLD.prospecto_id);
BEGIN
  IF v_cap IS NOT NULL THEN
    UPDATE public.captaciones c SET
      proximo_toque  = (SELECT min(a.fecha) FROM public.agenda a
                         WHERE a.captacion_id = c.id AND NOT a.completado AND a.fecha >= now()),
      proximo_motivo = (SELECT a.titulo FROM public.agenda a
                         WHERE a.captacion_id = c.id AND NOT a.completado AND a.fecha >= now()
                         ORDER BY a.fecha LIMIT 1)
    WHERE c.id = v_cap;
  END IF;

  IF v_pro IS NOT NULL THEN
    UPDATE public.prospectos p SET
      proximo_toque  = (SELECT min(a.fecha) FROM public.agenda a
                         WHERE a.prospecto_id = p.id AND NOT a.completado AND a.fecha >= now()),
      proximo_motivo = (SELECT a.titulo FROM public.agenda a
                         WHERE a.prospecto_id = p.id AND NOT a.completado AND a.fecha >= now()
                         ORDER BY a.fecha LIMIT 1)
    WHERE p.id = v_pro;
  END IF;

  IF v_lead IS NOT NULL THEN
    UPDATE public.leads l SET
      proximo_toque  = (SELECT min(a.fecha) FROM public.agenda a
                         WHERE a.lead_id = l.id AND NOT a.completado AND a.fecha >= now()),
      proximo_motivo = (SELECT a.titulo FROM public.agenda a
                         WHERE a.lead_id = l.id AND NOT a.completado AND a.fecha >= now()
                         ORDER BY a.fecha LIMIT 1)
    WHERE l.id = v_lead;
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS agenda_sincronizar_toque ON public.agenda;
CREATE TRIGGER agenda_sincronizar_toque
  AFTER INSERT OR UPDATE OR DELETE ON public.agenda
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_proximo_toque();


-- ------------------------------------------------------------
-- 6. EL SALTO. Una función, una transacción, idempotente por índice único.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promocionar_captacion(
  p_captacion_id bigint,
  p_agente_id    uuid,
  p_destino      text DEFAULT 'prospecto',
  p_nombre       text DEFAULT NULL,
  p_telefono     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  c          public.captaciones%ROWTYPE;
  v_tel      text;
  v_contacto uuid;
  v_prospecto uuid;
  v_alta     jsonb;
BEGIN
  -- El destino 'propiedad' se rechaza con un motivo, no en silencio. La firma
  -- lo acepta ya para no tener que cambiarla después: cambiar la lista de
  -- parámetros crearía una segunda función y las llamadas por nombre quedarían
  -- ambiguas ('function is not unique').
  IF p_destino <> 'prospecto' THEN
    RAISE EXCEPTION 'Sólo se puede promocionar a prospecto. La cartera la publica Inmovilla desde su XML y el CRM no puede crear una referencia: cierra el prospecto con propiedad_ref cuando el piso esté publicado.';
  END IF;

  -- 0) Cerrojo. Dos clics a la vez son dos transacciones distintas.
  SELECT * INTO c FROM public.captaciones WHERE id = p_captacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La captación % no existe', p_captacion_id;
  END IF;

  -- 1) Idempotencia: si ya se promocionó, se devuelve el mismo prospecto.
  SELECT id INTO v_prospecto FROM public.prospectos WHERE captacion_id = p_captacion_id;
  IF v_prospecto IS NOT NULL THEN
    RETURN jsonb_build_object('prospecto_id', v_prospecto, 'creado', false,
                              'motivo', 'ya_promocionada');
  END IF;

  -- 2) El contacto, por tres vías y en este orden.
  v_tel := public.normalizar_telefono(COALESCE(p_telefono, c.telefono));

  --   a) el lead espejo que creó el bot. COALESCE(duplicado_de, id) es la
  --      clave: si ese espejo ya estaba marcado como duplicado por la 019, el
  --      prospecto tiene que colgar del contacto CANÓNICO, no del duplicado.
  SELECT COALESCE(l.duplicado_de, l.id) INTO v_contacto
    FROM public.leads l
   WHERE l.captacion_id = p_captacion_id
   ORDER BY l.fecha_creacion ASC
   LIMIT 1;

  --   b) por teléfono normalizado: la misma persona pudo entrar por otra vía.
  --      `captaciones.telefono` es '34XXXXXXXXX' y `leads.telefono_norm` es
  --      '+34XXXXXXXXX'; normalizar_telefono() devuelve el mismo E.164 para los
  --      dos, que es justo para lo que se hizo.
  IF v_contacto IS NULL AND v_tel IS NOT NULL THEN
    SELECT id INTO v_contacto FROM public.leads
     WHERE telefono_norm = v_tel AND duplicado_de IS NULL
     ORDER BY fecha_creacion ASC
     LIMIT 1;
  END IF;

  --   c) no existe: se da de alta por la puerta de siempre, que deduplica.
  --      No un INSERT suelto: eso sería saltarse la 019.
  IF v_contacto IS NULL THEN
    IF v_tel IS NULL THEN
      RAISE EXCEPTION 'Esta captación no tiene un teléfono válido. Añádelo antes de promocionar.';
    END IF;
    v_alta := public.ingresar_lead(
      p_telefono => COALESCE(p_telefono, c.telefono),
      p_fuente   => 'Captaciones',
      p_nombre   => COALESCE(NULLIF(p_nombre, ''), c.nombre, 'Propietario'),
      p_canal    => 'whatsapp',
      p_resumen  => 'Alta al promocionar la captación ' || p_captacion_id);
    v_contacto := (v_alta ->> 'lead_id')::uuid;
  END IF;

  -- 3) Ese lead pasa a ser CONTACTO. Nunca se pisa lo que ya hubiera.
  UPDATE public.leads SET
    contacto_desde = COALESCE(contacto_desde, now()),
    captado_por    = COALESCE(captado_por, c.agente_id, p_agente_id),
    nombre = CASE WHEN COALESCE(NULLIF(btrim(nombre), ''), 'Propietario') = 'Propietario'
                  THEN COALESCE(NULLIF(p_nombre, ''), nombre) ELSE nombre END
  WHERE id = v_contacto;

  -- 4) El prospecto: la copia editable. A partir de aquí el scraper ya no la toca.
  INSERT INTO public.prospectos (
    contacto_id, captacion_id, captado_por, agente_id, creado_por, estado,
    direccion, barrio, precio, precio_salida, metros, habitaciones, banos,
    planta, tiene_ascensor, estado_inmueble, operacion, descripcion, imagenes,
    url_anuncio
  ) VALUES (
    v_contacto, p_captacion_id,
    COALESCE(c.agente_id, p_agente_id),   -- captado_por: SE CONGELA AQUÍ
    COALESCE(c.agente_id, p_agente_id),   -- agente_id: quien lo trabaja hoy
    p_agente_id,
    'Nuevo',
    c.calle, c.barrio, c.precio, c.precio, c.metros, c.habitaciones, c.banos,
    c.planta, c.tiene_ascensor, c.estado, c.raw_data ->> 'operation',
    c.descripcion, c.imagenes, c.url
  ) RETURNING id INTO v_prospecto;

  -- 5) Lo que colgaba de la captación cuelga también del prospecto.
  UPDATE public.agenda SET prospecto_id = v_prospecto
   WHERE captacion_id = p_captacion_id AND prospecto_id IS NULL;

  UPDATE public.captaciones SET prospecto_id = v_prospecto WHERE id = p_captacion_id;

  -- 6) Rastro, en los dos sitios que se leen.
  INSERT INTO public.historial_cambios
    (captacion_id, campo, valor_anterior, valor_nuevo, tipo_entidad)
  VALUES (p_captacion_id, 'promocion', NULL, 'prospecto:' || v_prospecto, 'captacion');

  INSERT INTO public.interacciones
    (lead_id, captacion_id, prospecto_id, tipo, direccion, canal, resumen,
     agente_id, automatica, ocurrida_en, meta)
  VALUES (v_contacto, p_captacion_id, v_prospecto, 'promocion', 'interna', 'crm',
          'Captación → Prospecto' || COALESCE(' · ' || c.calle, ''),
          p_agente_id, false, now(),
          jsonb_build_object('prospecto_id', v_prospecto));

  RETURN jsonb_build_object('prospecto_id', v_prospecto, 'contacto_id', v_contacto,
                            'creado', true);
END;
$fn$;

COMMENT ON FUNCTION public.promocionar_captacion IS
  'Convierte una captación en prospecto: resuelve o crea el contacto, copia la ficha, congela quién la captó y deja rastro. Idempotente.';


-- ------------------------------------------------------------
-- 7. Borrado protegido, versión con prospectos
--
-- Una captación YA PROMOCIONADA no se puede purgar, por dos motivos:
--   · se llevaría por delante la línea de tiempo del inmueble que SÍ se captó;
--   · al quedar `captacion_id` a NULL, el índice único parcial dejaría de
--     proteger, y como el scraper hace upsert por el MISMO id de Idealista, el
--     anuncio podría volver y crear un segundo prospecto del mismo piso.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_borrado_captacion()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_lead uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.prospectos p WHERE p.captacion_id = OLD.id) THEN
    RAISE EXCEPTION 'La captación % ya es un prospecto: archívala, no la borres.', OLD.id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(l.duplicado_de, l.id) INTO v_lead
    FROM public.leads l
   WHERE l.captacion_id = OLD.id
   ORDER BY l.fecha_creacion ASC
   LIMIT 1;

  UPDATE public.interacciones
     SET lead_id      = COALESCE(lead_id, v_lead),
         captacion_id = NULL,
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('captacion_borrada', OLD.id)
   WHERE captacion_id = OLD.id
     AND automatica = false
     AND COALESCE(lead_id, v_lead) IS NOT NULL;

  RETURN OLD;
END;
$fn$;


-- ------------------------------------------------------------
-- 8. Contactos: una vista, no una tabla
--
-- El contacto ES el lead canónico. `security_invoker` hace que la vista respete
-- los permisos de quien consulta y no los del dueño: sin eso, una vista es una
-- puerta trasera que se salta el RLS de la tabla de debajo.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.contactos WITH (security_invoker = true) AS
SELECT l.id, l.nombre, l.apellidos, l.email, l.telefono, l.telefono_norm, l.email_norm,
       l.fuente AS fuente_adquisicion, l.canal, l.estado, l.notas,
       l.fecha_creacion, l.contacto_desde, l.captado_por, l.asignado_en,
       l.atendido_en, l.atendido_por, l.proximo_toque, l.proximo_motivo,
       l.consent_rgpd, l.consent_en,
       (SELECT count(*) FROM public.prospectos p WHERE p.contacto_id = l.id) AS prospectos,
       (SELECT count(*) FROM public.interacciones i WHERE i.lead_id = l.id)  AS interacciones
  FROM public.leads l
 WHERE l.duplicado_de IS NULL;

COMMENT ON VIEW public.contactos IS
  'La ficha única de cada persona. Es una vista sobre los leads canónicos (sin duplicados): el contacto y el lead son la misma fila mirada desde otro sitio.';


-- ------------------------------------------------------------
-- 9. "¿A quién llamo hoy?"
--
-- La pantalla que decide si el comercial abre el CRM o el cuaderno. Junta lo
-- que tiene pendiente de las dos puntas del negocio en una sola lista.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mi_dia WITH (security_invoker = true) AS
SELECT 'captacion'::text AS ambito, c.id::text AS id, c.agente_id,
       COALESCE(c.calle, c.nombre) AS titulo, c.barrio, c.telefono,
       c.proximo_toque, c.proximo_motivo, c.atendido_en,
       c.estado_whatsapp AS senal
  FROM public.captaciones c
 WHERE c.activo AND c.prospecto_id IS NULL AND c.agente_id IS NOT NULL
UNION ALL
SELECT 'prospecto', p.id::text, p.agente_id,
       COALESCE(p.direccion, l.nombre), p.barrio, l.telefono,
       p.proximo_toque, p.proximo_motivo, p.atendido_en, p.estado
  FROM public.prospectos p
  JOIN public.leads l ON l.id = p.contacto_id
 WHERE p.estado NOT IN ('Captado', 'Perdido');


-- ------------------------------------------------------------
-- 10. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Los estados: 3 activos y 3 esperando a que alguien los encienda.
--   SELECT valor, activo FROM public.catalogos
--    WHERE tipo = 'estado_prospecto' ORDER BY orden;
--
--   -- El salto, sobre una captación interesada de verdad:
--   --   SELECT public.promocionar_captacion(
--   --     p_captacion_id => (SELECT id FROM public.captaciones
--   --                         WHERE estado_whatsapp = 'Interesado' AND activo LIMIT 1),
--   --     p_agente_id    => (SELECT id FROM public.perfiles LIMIT 1));
--   --
--   -- Llamarla DOS VECES tiene que devolver el mismo prospecto con creado=false.
--   --
--   -- Y comprobar lo que dejó:
--   --   SELECT p.estado, p.direccion, p.precio, p.captado_por, c.nombre AS contacto,
--   --          c.contacto_desde
--   --     FROM public.prospectos p JOIN public.contactos c ON c.id = p.contacto_id;
--
--   -- Que una captación promocionada NO se pueda borrar (debe dar excepción):
--   --   DELETE FROM public.captaciones WHERE prospecto_id IS NOT NULL;
--
--   -- Deshacer una prueba:
--   --   UPDATE public.captaciones SET prospecto_id = NULL WHERE prospecto_id IS NOT NULL;
--   --   DELETE FROM public.interacciones WHERE tipo = 'promocion';
--   --   DELETE FROM public.prospectos;
