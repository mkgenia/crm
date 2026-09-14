-- ============================================================
-- MIGRACIÓN 014: el reparto automático, en la base de datos
--
-- Los leads no los crea sólo el CRM. Los crean SIETE workflows de n8n
-- escribiendo directamente contra PostgREST: la landing de Instagram, el bot de
-- WhatsApp, la ficha de propiedad, la solicitud de valoración, la guía de los
-- 10 errores y las dos ramas del captador.
--
-- Por eso el reparto va aquí y no en el código del CRM. Si estuviera en una
-- acción de servidor, todo lo que entra por n8n se quedaría sin repartir; y
-- meterlo en los siete workflows es exactamente el error que ya tenemos con el
-- normalizador de leads, que está copiado cinco veces y donde arreglar uno no
-- arregla los otros cuatro.
--
-- Un solo sitio: un trigger BEFORE INSERT sobre `leads`. Entre por donde entre,
-- el lead sale ya con agente.
--
-- La lógica es la misma que `src/lib/asignacion.ts`, que está probada con 15
-- casos. Para que no se separen con el tiempo, el CRM NO reimplementa esto:
-- llama a `asignar_lead()` por RPC.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A quién le toca
--
-- Devuelve el agente y el motivo, sin escribir nada. Separado del trigger para
-- poder preguntarle "¿a quién le tocaría?" sin crear un lead.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siguiente_agente(
  p_telefono      text DEFAULT NULL,
  p_rechazado_por uuid[] DEFAULT '{}',
  -- Sólo para poder probarla: pasando un cursor se puede recorrer la rotación
  -- entera sin escribir nada. Una función que no se puede interrogar sin mover
  -- el estado real acaba sin probarse nunca.
  p_cursor        integer DEFAULT NULL
)
RETURNS TABLE (agente_id uuid, motivo text, cursor_nuevo integer)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cursor      integer;
  v_continuidad boolean;
  v_anterior    uuid;
  v_elegido     uuid;
  v_orden       integer;
BEGIN
  IF p_cursor IS NOT NULL THEN
    v_cursor := p_cursor;
  ELSE
    SELECT COALESCE((value #>> '{}')::integer, 0) INTO v_cursor
      FROM public.app_settings WHERE key = 'asignacion_cursor';
  END IF;
  v_cursor := COALESCE(v_cursor, 0);

  SELECT COALESCE((value -> 'continuidad')::boolean, true) INTO v_continuidad
    FROM public.app_settings WHERE key = 'asignacion_reglas';
  v_continuidad := COALESCE(v_continuidad, true);

  -- Continuidad: si este teléfono ya lo llevó alguien y sigue pudiendo, es suyo.
  -- Va antes que la rotación a propósito: que un cliente tenga que contarlo todo
  -- otra vez a otra persona es peor que un reparto perfectamente equilibrado.
  IF v_continuidad AND p_telefono IS NOT NULL AND p_telefono <> '' THEN
    SELECT l.captado_por INTO v_anterior
      FROM public.leads l
      JOIN public.perfiles p ON p.id = l.captado_por
     WHERE l.telefono = p_telefono
       AND l.captado_por IS NOT NULL
       AND p.disponible
       AND p.orden_reparto IS NOT NULL
       AND NOT (p.id = ANY (p_rechazado_por))
     ORDER BY l.fecha_creacion DESC
     LIMIT 1;

    IF v_anterior IS NOT NULL THEN
      RETURN QUERY SELECT v_anterior, 'Continuidad: ya llevaba este contacto'::text, v_cursor;
      RETURN;
    END IF;
  END IF;

  -- Rotación: el primero cuyo puesto esté por detrás del cursor. Si no queda
  -- ninguno, se vuelve al principio de la lista.
  SELECT p.id, p.orden_reparto INTO v_elegido, v_orden
    FROM public.perfiles p
   WHERE p.rol <> 'Admin'
     AND p.disponible
     AND p.orden_reparto IS NOT NULL
     AND NOT (p.id = ANY (p_rechazado_por))
     AND p.orden_reparto > v_cursor
   ORDER BY p.orden_reparto
   LIMIT 1;

  IF v_elegido IS NULL THEN
    SELECT p.id, p.orden_reparto INTO v_elegido, v_orden
      FROM public.perfiles p
     WHERE p.rol <> 'Admin'
       AND p.disponible
       AND p.orden_reparto IS NOT NULL
       AND NOT (p.id = ANY (p_rechazado_por))
     ORDER BY p.orden_reparto
     LIMIT 1;
  END IF;

  IF v_elegido IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'Nadie disponible en ese momento'::text, v_cursor;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_elegido, 'Turno de reparto'::text, v_orden;
END;
$$;

-- ------------------------------------------------------------
-- 2. El trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_lead_nuevo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_modo   text;
  v_agente uuid;
  v_motivo text;
  v_cursor integer;
BEGIN
  -- Quien ya viene con agente se respeta: el captador asigna sus propias
  -- captaciones y no hay que pisarle la decisión.
  IF NEW.captado_por IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT value #>> '{}' INTO v_modo FROM public.app_settings WHERE key = 'asignacion_modo';
  IF COALESCE(v_modo, 'manual') <> 'automatico' THEN
    NEW.asignacion_motivo := 'Reparto manual: espera en la bandeja';
    RETURN NEW;
  END IF;

  SELECT s.agente_id, s.motivo, s.cursor_nuevo
    INTO v_agente, v_motivo, v_cursor
    FROM public.siguiente_agente(NEW.telefono, COALESCE(NEW.rechazado_por, '{}')) s;

  NEW.asignacion_motivo := v_motivo;

  IF v_agente IS NOT NULL THEN
    NEW.captado_por := v_agente;
    NEW.asignado_en := now();
    -- asignado_por se queda a NULL: lo repartió el sistema, no una persona.
    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_reparto_automatico ON public.leads;
CREATE TRIGGER leads_reparto_automatico
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.repartir_lead_nuevo();

-- ------------------------------------------------------------
-- 3. Para el CRM
--
-- Repartir a mano un lead que ya existe (reasignar tras un rechazo, vaciar la
-- bandeja). Se expone por RPC para que el CRM no tenga una segunda copia de la
-- misma lógica en TypeScript.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.asignar_lead(p_lead_id uuid)
RETURNS TABLE (agente_id uuid, motivo text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tel     text;
  v_rech    uuid[];
  v_agente  uuid;
  v_motivo  text;
  v_cursor  integer;
BEGIN
  SELECT l.telefono, COALESCE(l.rechazado_por, '{}')
    INTO v_tel, v_rech
    FROM public.leads l WHERE l.id = p_lead_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'Ese lead ya no existe'::text;
    RETURN;
  END IF;

  SELECT s.agente_id, s.motivo, s.cursor_nuevo
    INTO v_agente, v_motivo, v_cursor
    FROM public.siguiente_agente(v_tel, v_rech) s;

  IF v_agente IS NOT NULL THEN
    UPDATE public.leads
       SET captado_por = v_agente, asignado_en = now(),
           asignado_por = NULL, asignacion_motivo = v_motivo
     WHERE id = p_lead_id;

    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';
  END IF;

  RETURN QUERY SELECT v_agente, v_motivo;
END;
$$;

-- ------------------------------------------------------------
-- 4. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- ¿A quién le tocaría ahora mismo? (no escribe nada)
--   SELECT * FROM public.siguiente_agente();
--
--   -- El modo sigue en manual, así que el trigger no reparte todavía:
--   SELECT value FROM public.app_settings WHERE key = 'asignacion_modo';
--
--   -- La rotación:
--   SELECT nombre, orden_reparto, disponible FROM public.perfiles
--    WHERE rol <> 'Admin' ORDER BY orden_reparto;
