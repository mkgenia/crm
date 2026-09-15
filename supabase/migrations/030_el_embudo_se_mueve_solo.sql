-- ============================================================
-- MIGRACIÓN 030: que el embudo se mueva solo, y marcar los que sobran
--
-- LA PRUEBA QUE MOTIVA ESTO.
-- Se simuló hoy el recorrido completo de un lead con datos reales: entra por la
-- ficha de una propiedad, se reparte a Amparo, Amparo llama dos veces, apunta
-- una nota de verdad y deja un recordatorio a una semana. Al terminar, su
-- estado seguía siendo **"Nuevo"**.
--
-- No es un caso raro: es el único caso. En los 473 cambios que hay registrados
-- en todo el historial del CRM, los hechos por una persona son CERO. Ni uno.
-- Todo lo que se ha movido lo movió un bot.
--
--   demandas.estado              1.825 filas, TODAS en 'Nuevo'
--   captaciones.estado_agenda      755 de 757 en 'pendiente'
--   leads.estado (demanda)         131 de 136 en 'Nuevo'
--
-- Un embudo que exige que alguien se acuerde de moverlo no se mueve. Así que o
-- se mueve solo con un gesto que el agente ya hace, o sobra.
--
-- QUÉ HACE ESTA MIGRACIÓN.
--   1. `atender()` mueve el embudo. El agente ya pulsa un chip al colgar
--      ("No contesta", "Le interesa", "No le interesa"); ese chip, que ya
--      existe y ya se guarda, pasa a mover el estado. Cero gestos nuevos.
--   2. Marca como obsoletas las tres columnas que no sirven. NO las borra:
--      primero que dejen de leerse y escribirse unos días.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Atender mueve el embudo
--
-- Dos movimientos, y el primero vale más que el segundo:
--
--   · SIEMPRE: 'Nuevo' -> 'Contactado'. Alguien ha descolgado el teléfono; eso
--     ya no es un lead nuevo, se mire como se mire. Esto solo saca a 131 de los
--     136 leads de demanda del limbo en cuanto alguien los llame.
--
--   · Y SEGÚN EL CHIP, si el agente pulsó uno:
--       Le interesa       -> Interesado
--       Quedamos en verlo -> Interesado
--       No le interesa    -> Perdido
--       No contesta       -> no toca nada más (no se ha hablado con nadie)
--       Se lo piensa      -> se queda en Contactado
--
-- NUNCA HACIA ATRÁS. Si el lead ya está en Propuesta, Negociación o Ganado, un
-- "no contesta" de una llamada suelta no lo devuelve a Contactado: la lista de
-- editables es la misma que usa el clasificador de WhatsApp desde hace meses,
-- por el mismo motivo — un automatismo no puede deshacer el trabajo de una
-- persona.
--
-- Los valores salen del catálogo igual que todo lo demás, así que renombrar
-- "Interesado" desde /configuracion/catalogos no rompe esto; lo que no se puede
-- es borrarlo, y el catálogo ya lo impide (son `sistema`).
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
  -- Los estados desde los que un automatismo puede mover. Más allá de
  -- 'Interesado' manda la persona que lo llevó hasta ahí.
  EDITABLES  constant text[] := ARRAY['Nuevo', 'Contactado', 'Interesado'];
BEGIN
  IF p_captacion_id IS NULL AND p_lead_id IS NULL AND p_prospecto_id IS NULL THEN
    RAISE EXCEPTION 'atender: falta a quién se ha atendido';
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
        -- Sin chip, o con 'no contesta' / 'se lo piensa': al menos deja de ser
        -- un lead sin estrenar. Es el movimiento que saca del limbo a los 131.
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

  -- El prospecto sólo se cierra: sus estados activos son Nuevo, Captado y
  -- Perdido, y "captado" lo decide una firma, no una llamada.
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
      -- El título se corta por PALABRA y no a machete en el carácter 60: un
      -- recordatorio que pone "...para concer" se ve roto en el calendario.
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
-- 2. Los embudos que sobran, marcados
--
-- No se borran todavía: primero tienen que dejar de leerse y escribirse en el
-- CRM y en n8n. Borrar una columna que alguien sigue leyendo da un error feo en
-- producción; marcarla no rompe nada y deja dicho por qué.
-- ------------------------------------------------------------
COMMENT ON COLUMN public.captaciones.estado_agenda IS
  'OBSOLETA (030). 755 de 757 en "pendiente": nadie la movió nunca. Las citas y los recordatorios son filas de `agenda` desde la 021. Pendiente de borrar.';

COMMENT ON COLUMN public.captaciones.estado_crm IS
  'OBSOLETA (030). Sólo la escribía el clasificador de WhatsApp, y describía lo mismo que el `estado` del lead espejo: la misma persona contada dos veces. Cómo va una captación lo dicen `estado_whatsapp` y `senal`; el embudo del trato vive en `prospectos.estado` desde la 022. Pendiente de borrar.';

COMMENT ON COLUMN public.captaciones.fecha_agenda IS 'OBSOLETA (021). Las citas son filas de `agenda`.';
COMMENT ON COLUMN public.captaciones.recordatorio_fecha IS 'OBSOLETA (021). Los recordatorios son filas de `agenda`.';
COMMENT ON COLUMN public.captaciones.notas_agenda IS 'OBSOLETA (021). Las notas son filas de `interacciones`.';


-- ------------------------------------------------------------
-- 3. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Atender a un lead que está en 'Nuevo' tiene que dejarlo en 'Contactado':
--   --   SELECT public.atender(
--   --     p_agente_id => (SELECT id FROM public.perfiles WHERE rol <> 'Admin' LIMIT 1),
--   --     p_lead_id   => (SELECT id FROM public.leads WHERE estado = 'Nuevo'
--   --                      AND duplicado_de IS NULL LIMIT 1),
--   --     p_nota      => 'Prueba 030');
--   --   -- devuelve estado_nuevo: "Contactado"
--   --
--   -- Y con el chip de "no le interesa", a Perdido con su fecha.
--   --
--   -- Y que el cambio queda firmado por la PERSONA, que es lo que nunca pasaba:
--   SELECT campo, valor_anterior, valor_nuevo, hecho_por
--     FROM public.historial_cambios
--    WHERE hecho_por IS NOT NULL ORDER BY fecha DESC LIMIT 5;
--   -- Antes de esta migración, esa consulta devolvía CERO filas.
