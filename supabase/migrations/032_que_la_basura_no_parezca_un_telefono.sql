-- ============================================================
-- MIGRACIÓN 032: que la basura no acabe pareciendo un teléfono de verdad
--
-- DE DÓNDE SALE ESTO.
-- Una batería de 45 ataques contra las funciones del CRM: entradas sucias por
-- los webhooks, el reparto bajo presión y `atender()` con datos imposibles.
-- El motor de reparto aguantó los 8 ataques sin un solo fallo, y el recorrido
-- completo de un lead de Instagram y otro de la web pasó 11 de 11. Lo que sigue
-- es lo que SÍ se dobló.
--
-- LO IMPORTANTE ES DÓNDE.
-- `atender()` sólo la llama un agente con la sesión abierta: lo peor que puede
-- pasar ahí es una errata. `ingresar_lead()` la llaman CINCO WEBHOOKS PÚBLICOS,
-- y ahí no hay nadie mirando. El blindaje va sobre todo en la puerta de la
-- calle.
--
-- EL FALLO QUE MÁS ASUSTA, y no es el que parece.
-- `normalizar_telefono()` borra todo lo que no sea un dígito. Así que esto:
--
--     "600123456'; DROP TABLE leads; --"      ->  +34600123456
--     "600📞123456"                            ->  +34600123456
--
-- La inyección es inofensiva (por eso se borra todo), pero el resultado NO lo
-- es: un campo corrupto se convierte en un móvil español perfectamente válido
-- **que es de otra persona**. Y a ese número le escribe el bot de WhatsApp. No
-- es una fuga de datos: es llamar a la puerta de un desconocido en nombre de la
-- agencia, que es justo lo que costó el bloqueo de 24 h del 10/09/2026.
--
-- Y sin tope por arriba, treinta dígitos también pasaban:
--     "123456789012345678901234567890"  ->  +123456789012345678901234567890
--
-- COMPROBADO ANTES DE TOCAR NADA: hoy no hay NI UNA fila así. Ni en los 1.019
-- leads vivos ni en las 757 captaciones activas. Esto es una puerta abierta por
-- la que todavía no ha entrado nadie, no un incendio. Por eso se puede cerrar
-- sin prisa y sin arreglar nada hacia atrás.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El normalizador, con las dos guardas que le faltaban
--
-- El índice `leads_telefono_norm_idx` es sobre la COLUMNA, no sobre la función,
-- así que cambiarla no corrompe ningún índice. Los `telefono_norm` ya
-- calculados se quedan como están; esto sólo afecta a lo que entre a partir de
-- ahora, y como no hay ninguno malo, no hay nada que rehacer.
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

  -- GUARDA 1: un campo de teléfono no lleva letras ni comillas. Si las lleva,
  -- no es un teléfono mal escrito: es otra cosa que ha caído en el sitio
  -- equivocado —un nombre, un texto libre, un formulario corrupto, un intento
  -- de inyección—. Quedarse con los dígitos sueltos y llamar al número que
  -- salga es peor que no tener teléfono.
  --
  -- Comprobado sobre los datos reales antes de escribir esto: de los 1.080
  -- leads y las 757 captaciones que hoy tienen teléfono, CERO lo tienen con una
  -- letra y CERO con uno de estos símbolos. Esta guarda no deja fuera a nadie
  -- de los que ya entran bien.
  --
  -- No se rechaza por emoji ni por espacios raros: eso es suciedad de copiar y
  -- pegar, y los dígitos que hay debajo suelen ser correctos. Lo que se rechaza
  -- es lo que delata que el campo contiene OTRA COSA.
  IF t ~ '[A-Za-zÀ-ÿ]' OR t ~ '[''";<>\\]' THEN RETURN NULL; END IF;

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

  -- GUARDA 2: el tope por arriba, que no existía. E.164 —la norma que usan
  -- WhatsApp y cualquier operador— no pasa de 15 dígitos. Todo lo que mida más
  -- es un identificador, una fecha pegada, o dos teléfonos juntos.
  IF length(d) > 15 THEN RETURN NULL; END IF;

  RETURN '+' || d;
END;
$fn$;

COMMENT ON FUNCTION public.normalizar_telefono(text) IS
  'Pasa un teléfono a E.164 (+34...). Devuelve NULL si el texto lleva letras o si no mide entre 9 y 15 dígitos: más vale un lead sin teléfono que un lead con el teléfono de un desconocido.';


-- ------------------------------------------------------------
-- 2. atender(): que una errata no se trague un recordatorio
--
-- Dos cosas se doblaron, las dos por teclear mal, no por mala fe:
--
--   · `p_resultado => 'platano'` se guardaba tan tranquilo. No revienta nada,
--     pero el chip no se pinta, el embudo no se mueve y nadie se entera: el
--     agente cree que ha marcado "le interesa" y el lead se queda en Contactado.
--     Ahora se comprueba contra el catálogo, que ya tiene sus cinco valores
--     (interesado, no_contesta, no_interesa, se_lo_piensa, visita).
--
--   · Un recordatorio para el año 9999 se creaba sin rechistar. Quien escribe
--     2925 en vez de 2025 pierde el aviso para siempre y no hay ningún sitio
--     donde se vea que se ha perdido. Se acota a una ventana con sentido.
--
-- Se valida contra el catálogo ENTERO, activo o no. Si mañana se desactiva un
-- resultado desde /configuracion/catalogos, las pantallas que ya estén abiertas
-- siguen funcionando en vez de empezar a dar errores.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atender(
  p_agente_id       uuid,
  p_captacion_id    bigint      DEFAULT NULL,
  p_prospecto_id    uuid        DEFAULT NULL,
  p_lead_id         uuid        DEFAULT NULL,
  p_nota            text        DEFAULT NULL,
  p_tipo            text        DEFAULT 'llamada',
  p_resultado       text        DEFAULT NULL,
  p_recordar_en     timestamptz DEFAULT NULL,
  p_recordar_titulo text        DEFAULT NULL,
  p_todo_el_dia     boolean     DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_contacto uuid := p_lead_id;
  v_resumen  text;
  v_inter    uuid;
  v_agenda   uuid;
  v_dueno    uuid;
  v_estado   text;
  v_movido   text;
  EDITABLES  constant text[] := ARRAY['Nuevo', 'Contactado', 'Interesado'];
BEGIN
  IF p_captacion_id IS NULL AND p_lead_id IS NULL AND p_prospecto_id IS NULL THEN
    RAISE EXCEPTION 'atender: falta a quién se ha atendido';
  END IF;

  -- El resultado, contra el catálogo.
  IF p_resultado IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.catalogos
        WHERE tipo = 'resultado_atencion' AND valor = p_resultado) THEN
    RAISE EXCEPTION 'atender: el resultado "%" no está en el catálogo. Los que hay: %',
      p_resultado,
      (SELECT string_agg(valor, ', ' ORDER BY orden)
         FROM public.catalogos WHERE tipo = 'resultado_atencion');
  END IF;

  -- El recordatorio, dentro de una ventana con sentido: nada anterior a ayer
  -- (que ya nació vencido) ni más allá de cinco años (que es una errata).
  IF p_recordar_en IS NOT NULL
     AND (p_recordar_en < now() - interval '1 day'
       OR p_recordar_en > now() + interval '5 years') THEN
    RAISE EXCEPTION 'atender: la fecha del recordatorio (%) no tiene sentido; tiene que caer entre ayer y dentro de cinco años',
      to_char(p_recordar_en AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI');
  END IF;

  -- La nota cuelga SIEMPRE también de la persona, para que se lea en su ficha
  -- aunque se escribiera desde el anuncio o desde el prospecto.
  IF v_contacto IS NULL AND p_captacion_id IS NOT NULL THEN
    SELECT COALESCE(l.duplicado_de, l.id) INTO v_contacto
      FROM public.leads l WHERE l.captacion_id = p_captacion_id
     ORDER BY l.fecha_creacion ASC LIMIT 1;
  END IF;
  IF v_contacto IS NULL AND p_prospecto_id IS NOT NULL THEN
    SELECT contacto_id INTO v_contacto FROM public.prospectos WHERE id = p_prospecto_id;
  END IF;

  v_resumen := COALESCE(
    NULLIF(left(btrim(regexp_replace(COALESCE(p_nota, ''), '\s+', ' ', 'g')), 120), ''),
    'Atendido');

  INSERT INTO public.interacciones
    (lead_id, captacion_id, prospecto_id, tipo, direccion, canal, resumen, detalle,
     agente_id, automatica, ocurrida_en, meta)
  VALUES (v_contacto, p_captacion_id, p_prospecto_id, p_tipo, 'saliente',
          CASE WHEN p_tipo = 'llamada' THEN 'telefono' ELSE 'crm' END,
          v_resumen, NULLIF(btrim(p_nota), ''), p_agente_id, false, now(),
          jsonb_build_object('atendido', true, 'resultado', p_resultado))
  RETURNING id INTO v_inter;

  -- Quien atiende una captación de nadie, se la queda.
  IF p_captacion_id IS NOT NULL THEN
    SELECT agente_id INTO v_dueno FROM public.captaciones WHERE id = p_captacion_id;
    IF v_dueno IS NULL THEN
      UPDATE public.captaciones
         SET agente_id = p_agente_id, asignado_en = now(), asignado_por = p_agente_id,
             asignacion_motivo = 'Se la quedó al atenderla'
       WHERE id = p_captacion_id AND agente_id IS NULL;
    END IF;
  END IF;

  -- ---- EL EMBUDO ----
  IF v_contacto IS NOT NULL THEN
    SELECT estado INTO v_estado FROM public.leads WHERE id = v_contacto;

    IF COALESCE(v_estado, 'Nuevo') = ANY (EDITABLES) THEN
      v_movido := CASE p_resultado
        WHEN 'interesado'  THEN 'Interesado'
        WHEN 'visita'      THEN 'Interesado'
        WHEN 'no_interesa' THEN 'Perdido'
        ELSE CASE WHEN COALESCE(v_estado, 'Nuevo') = 'Nuevo' THEN 'Contactado' END
      END;

      IF v_movido IS NOT NULL AND v_movido <> COALESCE(v_estado, '') THEN
        UPDATE public.leads
           SET estado = v_movido,
               perdido_en = CASE WHEN v_movido = 'Perdido' THEN now() ELSE perdido_en END
         WHERE id = v_contacto;

        INSERT INTO public.historial_cambios
          (lead_id, campo, valor_anterior, valor_nuevo, hecho_por, tipo_entidad)
        VALUES (v_contacto, 'estado', v_estado, v_movido, p_agente_id, 'lead');
      END IF;
    END IF;
  END IF;

  IF p_prospecto_id IS NOT NULL AND p_resultado = 'no_interesa' THEN
    UPDATE public.prospectos
       SET estado = 'Perdido', perdido_en = now()
     WHERE id = p_prospecto_id AND estado = 'Nuevo';
  END IF;

  -- El recordatorio, como fila de agenda: sale solo en /calendario.
  IF p_recordar_en IS NOT NULL THEN
    INSERT INTO public.agenda
      (titulo, descripcion, tipo, fecha, todo_el_dia, agente_id, creado_por,
       captacion_id, lead_id, prospecto_id)
    VALUES (
      COALESCE(NULLIF(p_recordar_titulo, ''),
               CASE WHEN length(v_resumen) > 60
                    THEN regexp_replace(left(v_resumen, 60), '\s+\S*$', '') || '…'
                    ELSE v_resumen END),
      NULLIF(btrim(p_nota), ''), 'recordatorio', p_recordar_en, p_todo_el_dia,
      p_agente_id, p_agente_id, p_captacion_id, v_contacto, p_prospecto_id)
    RETURNING id INTO v_agenda;

    UPDATE public.interacciones
       SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('agenda_id', v_agenda)
     WHERE id = v_inter;
  END IF;

  RETURN jsonb_build_object('interaccion_id', v_inter, 'agenda_id', v_agenda,
                            'contacto_id', v_contacto, 'estado_nuevo', v_movido);
END;
$fn$;


-- ------------------------------------------------------------
-- 3. Los estados que ya no se escriben, fuera de los desplegables
--
-- "Si ves que el embudo no se muestra es porque es inútil, quita los embudos
-- que no sirven para nada."
--
-- Se DESACTIVAN, no se borran: `historial_cambios` guarda cambios antiguos que
-- apuntan a estos valores, y borrarlos dejaría el historial contando una
-- historia con palabras que ya no existen.
--
--   estado_whatsapp / Interesado      0 captaciones — la 027 lo fundió en
--   estado_whatsapp / Quiere_Llamada  0 captaciones   "Respondido" + señal.
--                                                     Hoy: 68 con señal
--                                                     "interesado" y 27 con
--                                                     "quiere_llamada".
--   estado_lead / test                0 leads       — restos de una prueba.
-- ------------------------------------------------------------
UPDATE public.catalogos SET activo = false, updated_at = now()
 WHERE tipo = 'estado_whatsapp' AND valor IN ('Interesado', 'Quiere_Llamada')
   AND activo;

UPDATE public.catalogos SET activo = false, updated_at = now()
 WHERE tipo = 'estado_lead' AND valor = 'test' AND activo;


-- ------------------------------------------------------------
-- 4. Un lead no puede ser duplicado de sí mismo
--
-- Escribir `duplicado_de = id` hace desaparecer la ficha: TODAS las consultas
-- del CRM filtran por `duplicado_de IS NULL`, así que esa persona se cae de las
-- listas, del reparto y del buscador a la vez, y desde la interfaz no hay
-- ninguna forma de volver a encontrarla. Un cliente borrado sin borrarlo.
--
-- ESTO HOY NO PUEDE PASAR SOLO: el trigger `marcar_duplicado_lead()` ya lleva
-- `AND id <> NEW.id` y sólo actúa al dar de alta. Comprobado además sobre la
-- tabla entera: 0 leads duplicados de sí mismos, 0 cadenas (un duplicado que
-- apunta a otro duplicado) y 0 que apunten a una ficha que ya no existe, sobre
-- 1.081 filas y 60 duplicados.
--
-- Se pone igualmente, porque es una barandilla de tres líneas y protege de lo
-- que el trigger no ve: un UPDATE a mano, un script con la clave de servicio, o
-- un fallo futuro en el código del CRM.
-- ------------------------------------------------------------
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_no_duplicado_de_si_mismo;
ALTER TABLE public.leads ADD CONSTRAINT leads_no_duplicado_de_si_mismo
  CHECK (duplicado_de IS NULL OR duplicado_de <> id);


-- ------------------------------------------------------------
-- 5. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- El normalizador, con los casos que antes pasaban:
--   SELECT public.normalizar_telefono('600123456''; DROP TABLE leads; --') AS inyeccion,   -- NULL
--          public.normalizar_telefono('Llamar al 600123456')                AS contexto,   -- NULL
--          public.normalizar_telefono('600📞123456')                        AS emoji,      -- +34600123456 (suciedad, no otra cosa)
--          public.normalizar_telefono('123456789012345678901234567890')     AS treinta,    -- NULL
--          public.normalizar_telefono('+34 600 90 01 21')                   AS bueno,      -- +34600900121
--          public.normalizar_telefono('0034600900121')                      AS con00,      -- +34600900121
--          public.normalizar_telefono('963123456')                          AS fijo;       -- +34963123456
--
--   -- Y que no ha dejado fuera a nadie que hoy entra bien: debe salir 0.
--   SELECT count(*) FROM public.leads
--    WHERE telefono IS NOT NULL AND telefono_norm IS NOT NULL
--      AND public.normalizar_telefono(telefono) IS NULL;
--
--   SELECT count(*) FROM public.captaciones
--    WHERE activo AND telefono IS NOT NULL
--      AND public.normalizar_telefono(telefono) IS NULL;
--
--   -- atender() con un resultado inventado ahora protesta:
--   --   SELECT public.atender(
--   --     p_agente_id => (SELECT id FROM public.perfiles WHERE rol <> 'Admin' LIMIT 1),
--   --     p_lead_id   => (SELECT id FROM public.leads WHERE duplicado_de IS NULL LIMIT 1),
--   --     p_resultado => 'platano');
--   --   -- ERROR: el resultado "platano" no está en el catálogo. Los que hay: ...
--
--   -- Y los valores jubilados ya no salen en los desplegables:
--   SELECT tipo, valor, activo FROM public.catalogos
--    WHERE (tipo = 'estado_whatsapp' AND valor IN ('Interesado','Quiere_Llamada'))
--       OR (tipo = 'estado_lead' AND valor = 'test');
--
--   -- La barandilla del duplicado. Esto tiene que DAR ERROR:
--   --   UPDATE public.leads SET duplicado_de = id
--   --    WHERE id = (SELECT id FROM public.leads LIMIT 1);
--   --   -- ERROR: new row violates check constraint "leads_no_duplicado_de_si_mismo"
