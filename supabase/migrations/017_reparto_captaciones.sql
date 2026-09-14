-- ============================================================
-- MIGRACIÓN 017: el reparto es de CAPTACIONES, no de leads
--
-- Corrección de rumbo. Las migraciones 013 y 014 montaron el reparto sobre
-- `leads`, y lo que se reparte entre los agentes son las CAPTACIONES: los
-- propietarios que saca el scraper de Idealista y a los que hay que llamar.
-- Un lead de la landing o del formulario web no se reparte hoy por hoy.
--
-- Qué cambia:
--   - El trigger se va de `leads` y se pone en `captaciones`.
--   - `captaciones` recibe las mismas cuatro columnas de trazabilidad.
--   - La continuidad mira el histórico de captaciones, no el de leads.
--
-- Qué NO cambia: la rotación, la disponibilidad y el orden de los agentes viven
-- en `perfiles` y valen igual para lo que se reparta.
--
-- Las columnas que la 013 añadió a `leads` se quedan, sin usar. Quitarlas es
-- destructivo y el reparto de leads es un "de momento no", no un "nunca": el
-- día que haga falta, están puestas.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Quitar el reparto de leads
--
-- Se borra el trigger, no las columnas. Sin trigger, `leads` vuelve a
-- comportarse exactamente como antes de la 014.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS leads_reparto_automatico ON public.leads;

COMMENT ON COLUMN public.leads.asignacion_motivo IS
  'Sin uso desde la migración 017: hoy sólo se reparten captaciones. La columna '
  'se conserva para el día que se reparta también lo que entra por la web.';

-- ------------------------------------------------------------
-- 2. Trazabilidad en captaciones
-- ------------------------------------------------------------
ALTER TABLE public.captaciones
  ADD COLUMN IF NOT EXISTS asignado_en       timestamptz,
  ADD COLUMN IF NOT EXISTS asignado_por      uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignacion_motivo text,
  ADD COLUMN IF NOT EXISTS rechazado_por     uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.captaciones.asignacion_motivo IS
  'Por qué le tocó a ese agente: "turno de reparto", "continuidad: ya llevaba '
  'este teléfono", "a mano por Josep". Se enseña en la ficha de la captación.';

CREATE INDEX IF NOT EXISTS captaciones_sin_agente_idx
  ON public.captaciones (created_at DESC) WHERE agente_id IS NULL AND activo;

-- ------------------------------------------------------------
-- 3. La continuidad, ahora sobre captaciones
--
-- Mismo criterio que antes pero mirando dónde toca: si a este teléfono ya le
-- llamó alguien del equipo, la siguiente captación suya es de ese mismo agente.
-- Que un propietario reciba dos llamadas de dos personas distintas de la misma
-- agencia es la peor carta de presentación posible.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siguiente_agente(
  p_telefono      text DEFAULT NULL,
  p_rechazado_por uuid[] DEFAULT '{}',
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

  IF v_continuidad AND p_telefono IS NOT NULL AND p_telefono <> '' THEN
    SELECT c.agente_id INTO v_anterior
      FROM public.captaciones c
      JOIN public.perfiles p ON p.id = c.agente_id
     WHERE c.telefono = p_telefono
       AND c.agente_id IS NOT NULL
       AND p.disponible
       AND p.orden_reparto IS NOT NULL
       AND NOT (p.id = ANY (p_rechazado_por))
     ORDER BY c.created_at DESC
     LIMIT 1;

    IF v_anterior IS NOT NULL THEN
      RETURN QUERY SELECT v_anterior, 'Continuidad: ya llevaba este teléfono'::text, v_cursor;
      RETURN;
    END IF;
  END IF;

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
-- 4. El trigger, sobre captaciones
--
-- Va aquí y no en el código del CRM porque las captaciones las crea el workflow
-- "2 · Captador — Ingesta y Fotos" escribiendo directo contra PostgREST, sin
-- pasar por Next en ningún momento.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_captacion_nueva()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_modo   text;
  v_agente uuid;
  v_motivo text;
  v_cursor integer;
BEGIN
  -- Si ya viene con agente, se respeta.
  IF NEW.agente_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Un traspaso o una captación sin teléfono no se reparten: nadie va a llamar.
  -- Repartirlas sólo sirve para inflar la carga de un agente con trabajo que no
  -- existe y para desordenar el turno de los demás.
  IF NEW.activo IS FALSE OR NEW.telefono IS NULL OR NEW.telefono = '' THEN
    RETURN NEW;
  END IF;

  SELECT value #>> '{}' INTO v_modo FROM public.app_settings WHERE key = 'asignacion_modo';
  IF COALESCE(v_modo, 'manual') <> 'automatico' THEN
    NEW.asignacion_motivo := 'Reparto manual: espera sin asignar';
    RETURN NEW;
  END IF;

  SELECT s.agente_id, s.motivo, s.cursor_nuevo
    INTO v_agente, v_motivo, v_cursor
    FROM public.siguiente_agente(NEW.telefono, COALESCE(NEW.rechazado_por, '{}')) s;

  NEW.asignacion_motivo := v_motivo;

  IF v_agente IS NOT NULL THEN
    NEW.agente_id   := v_agente;
    NEW.asignado_en := now();
    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS captaciones_reparto_automatico ON public.captaciones;
CREATE TRIGGER captaciones_reparto_automatico
  BEFORE INSERT ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.repartir_captacion_nueva();

-- ------------------------------------------------------------
-- 5. Repartir una que ya existe, desde el CRM
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.asignar_lead(uuid);

CREATE OR REPLACE FUNCTION public.asignar_captacion(p_captacion_id bigint)
RETURNS TABLE (agente_id uuid, motivo text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tel    text;
  v_rech   uuid[];
  v_agente uuid;
  v_motivo text;
  v_cursor integer;
BEGIN
  SELECT c.telefono, COALESCE(c.rechazado_por, '{}')
    INTO v_tel, v_rech
    FROM public.captaciones c WHERE c.id = p_captacion_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'Esa captación ya no existe'::text;
    RETURN;
  END IF;

  SELECT s.agente_id, s.motivo, s.cursor_nuevo
    INTO v_agente, v_motivo, v_cursor
    FROM public.siguiente_agente(v_tel, v_rech) s;

  IF v_agente IS NOT NULL THEN
    UPDATE public.captaciones
       SET agente_id = v_agente, asignado_en = now(),
           asignado_por = NULL, asignacion_motivo = v_motivo, visto_en = NULL
     WHERE id = p_captacion_id;

    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';
  END IF;

  RETURN QUERY SELECT v_agente, v_motivo;
END;
$$;

-- ------------------------------------------------------------
-- 6. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- El trigger de leads ya no está y el de captaciones sí:
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--    WHERE tgname IN ('leads_reparto_automatico','captaciones_reparto_automatico');
--
--   -- A quién le tocaría ahora (no escribe nada):
--   SELECT * FROM public.siguiente_agente();
--
--   -- Cuántas esperan:
--   SELECT count(*) FROM public.captaciones WHERE agente_id IS NULL AND activo;
