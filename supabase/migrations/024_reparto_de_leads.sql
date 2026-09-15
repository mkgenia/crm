-- ============================================================
-- MIGRACIÓN 024: los leads también se reparten
--
-- POR QUÉ.
-- Hasta ahora sólo se repartían captaciones. Los leads de demanda —los que
-- entran por la landing de Instagram o por la ficha de una propiedad— no tenían
-- dueño y se quedaban donde caían. Medido hoy:
--
--   leads de demanda vivos .......... 136   (121 Instagram + 15 Ficha)
--   de esos, CON agente ..............  0
--
-- Ciento treinta y seis personas que levantaron la mano y a las que no le toca
-- llamar a nadie en concreto. El más antiguo lleva esperando desde el 21 de
-- junio.
--
-- Y OJO CON LA DIFERENCIA: una captación se reparte cuando el propietario
-- muestra interés (020), porque antes es un anuncio al que nadie ha escrito. Un
-- lead de demanda se reparte AL ENTRAR, porque rellenar un formulario ya es el
-- interés. No son la misma regla y no deben compartirla.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Un lead tiene DOS personas, igual que un prospecto
--
--   captado_por -> quién lo trajo. No cambia nunca.
--   agente_id   -> quién lo trabaja hoy. Se traspasa.
--
-- Hasta ahora `captado_por` hacía las dos cosas, que es el mismo enredo que
-- teníamos en captaciones: cada traspaso borraba al captador.
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS agente_id uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignacion_motivo text;

-- Lo que hubiera en captado_por era, de hecho, el que lo trabajaba: se copia.
UPDATE public.leads
   SET agente_id = captado_por
 WHERE agente_id IS NULL AND captado_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_agente_idx
  ON public.leads (agente_id, estado) WHERE duplicado_de IS NULL;

CREATE INDEX IF NOT EXISTS leads_sin_agente_idx
  ON public.leads (fecha_creacion)
  WHERE agente_id IS NULL AND duplicado_de IS NULL;


-- ------------------------------------------------------------
-- 2. La continuidad, arreglada
--
-- La versión de la 017 sólo miraba `captaciones` y comparaba el teléfono EN
-- CRUDO. Eso valía mientras sólo hubiera captaciones, porque las escribe el
-- scraper siempre con el mismo formato. Con leads no vale: en esa tabla
-- convivían cuatro formatos y por eso la 019 tuvo que normalizar.
--
-- Ahora mira las dos tablas y compara en E.164, que es para lo que se hizo
-- `telefono_norm`. La firma NO cambia: cambiarla crearía una segunda función y
-- las llamadas por nombre quedarían ambiguas.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siguiente_agente(
  p_telefono      text DEFAULT NULL,
  p_rechazado_por uuid[] DEFAULT '{}',
  p_cursor        integer DEFAULT NULL
)
RETURNS TABLE (agente_id uuid, motivo text, cursor_nuevo integer)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_cursor      integer;
  v_continuidad boolean;
  v_anterior    uuid;
  v_elegido     uuid;
  v_orden       integer;
  v_tel         text := public.normalizar_telefono(p_telefono);
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

  -- Si esta persona ya la lleva alguien, sigue siendo suya: da igual que la
  -- vez anterior entrara como captación y ésta como lead de Instagram. Para el
  -- que descuelga el teléfono es la misma conversación.
  IF v_continuidad AND v_tel IS NOT NULL THEN
    SELECT x.agente_id INTO v_anterior
      FROM (
        SELECT c.agente_id, c.created_at
          FROM public.captaciones c
         WHERE public.normalizar_telefono(c.telefono) = v_tel
           AND c.agente_id IS NOT NULL
        UNION ALL
        SELECT l.agente_id, l.fecha_creacion
          FROM public.leads l
         WHERE l.telefono_norm = v_tel
           AND l.agente_id IS NOT NULL
           AND l.duplicado_de IS NULL
      ) x
      JOIN public.perfiles p ON p.id = x.agente_id
     WHERE p.disponible
       AND p.orden_reparto IS NOT NULL
       AND NOT (p.id = ANY (p_rechazado_por))
     ORDER BY x.created_at DESC
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

  -- Se acabó la vuelta: se empieza otra desde el principio.
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
$fn$;


-- ------------------------------------------------------------
-- 3. Repartir al entrar
--
-- En TRIGGER y no en el CRM porque los leads los crean CINCO webhooks públicos
-- de n8n escribiendo directo contra PostgREST, sin pasar por este código. Si la
-- rotación viviera en TypeScript, todo lo que entra por la landing se quedaría
-- sin repartir — que es exactamente lo que pasa hoy.
--
-- No se reparten los espejos de captación: ésos son la sombra de un anuncio y
-- se reparten por su lado, cuando el propietario muestra interés (020).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_lead_nuevo()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_modo   text;
  v_agente uuid;
  v_motivo text;
  v_cursor integer;
BEGIN
  IF NEW.agente_id IS NOT NULL OR NEW.duplicado_de IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- El espejo de una captación no se reparte aquí.
  IF NEW.captacion_id IS NOT NULL OR NEW.fuente = 'Captaciones' THEN
    RETURN NEW;
  END IF;

  SELECT value #>> '{}' INTO v_modo FROM public.app_settings WHERE key = 'asignacion_modo';
  IF COALESCE(v_modo, 'manual') <> 'automatico' THEN
    NEW.asignacion_motivo := 'Reparto manual: esperando asignación';
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
$fn$;

-- Después del trigger de identidad de la 019, que es quien rellena
-- telefono_norm: los triggers BEFORE corren por orden alfabético de nombre y
-- 'leads_identidad' < 'leads_reparto'.
DROP TRIGGER IF EXISTS leads_reparto ON public.leads;
CREATE TRIGGER leads_reparto
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.repartir_lead_nuevo();


-- ------------------------------------------------------------
-- 4. Repartir de golpe lo que ya está esperando
--
-- Los 136 que llevan meses sin dueño. El que lleva más tiempo esperando, primero.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_leads_pendientes(p_tope integer DEFAULT 50)
RETURNS TABLE (repartidos integer, sin_agente integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r          record;
  v_agente   uuid;
  v_motivo   text;
  v_cursor   integer;
  v_hechos   integer := 0;
  v_fallidos integer := 0;
BEGIN
  FOR r IN
    SELECT id, telefono, rechazado_por
      FROM public.leads
     WHERE agente_id IS NULL
       AND duplicado_de IS NULL
       AND captacion_id IS NULL
       AND fuente IS DISTINCT FROM 'Captaciones'
     ORDER BY fecha_creacion ASC
     LIMIT GREATEST(p_tope, 0)
  LOOP
    SELECT s.agente_id, s.motivo, s.cursor_nuevo
      INTO v_agente, v_motivo, v_cursor
      FROM public.siguiente_agente(r.telefono, COALESCE(r.rechazado_por, '{}')) s;

    IF v_agente IS NULL THEN
      -- Sin nadie disponible: se anota el motivo y se sigue. Parar aquí dejaría
      -- sin repartir a los siguientes por culpa de uno.
      UPDATE public.leads SET asignacion_motivo = v_motivo WHERE id = r.id;
      v_fallidos := v_fallidos + 1;
      CONTINUE;
    END IF;

    UPDATE public.leads
       SET agente_id = v_agente, asignado_en = now(), asignacion_motivo = v_motivo
     WHERE id = r.id;

    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';

    v_hechos := v_hechos + 1;
  END LOOP;

  RETURN QUERY SELECT v_hechos, v_fallidos;
END;
$fn$;

COMMENT ON FUNCTION public.repartir_leads_pendientes(integer) IS
  'Reparte los leads de demanda que se quedaron sin agente. Devuelve (repartidos, sin_agente).';


-- ------------------------------------------------------------
-- 5. "¿A quién llamo hoy?" — ahora con los leads dentro
--
-- Es la lista que el comercial abre por la mañana. Si los leads de Instagram no
-- salen ahí, da igual que estén repartidos: nadie los va a ver.
--
-- La vista trae una columna `prioridad` calculada, y no es un adorno: sin ella
-- la pantalla tendría que ordenar por `proximo_toque` y eso pone lo agendado
-- para la semana que viene POR ENCIMA de lo que no ha tocado nadie nunca. Con
-- 136 leads sin estrenar, eso los manda al fondo justo el día que empiezan a
-- repartirse. PostgREST no sabe ordenar por una expresión, así que la expresión
-- vive aquí:
--
--   0  vencido: tenía fecha y ya pasó. Esto es lo que se prometió y no se hizo.
--   1  nunca atendido. El que lleva más tiempo esperando, primero.
--   2  agendado para más adelante.
--   3  el resto: ya se atendió y no hay nada prometido.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mi_dia WITH (security_invoker = true) AS
WITH todo AS (
  SELECT 'captacion'::text AS ambito, c.id::text AS id, c.agente_id,
         COALESCE(c.calle, c.nombre) AS titulo, c.barrio, c.telefono,
         c.proximo_toque, c.proximo_motivo, c.atendido_en,
         c.estado_whatsapp AS senal, c.created_at AS entro_en
    FROM public.captaciones c
   WHERE c.activo AND c.prospecto_id IS NULL AND c.agente_id IS NOT NULL
  UNION ALL
  SELECT 'prospecto', p.id::text, p.agente_id,
         COALESCE(p.direccion, l.nombre), p.barrio, l.telefono,
         p.proximo_toque, p.proximo_motivo, p.atendido_en, p.estado, p.created_at
    FROM public.prospectos p
    JOIN public.leads l ON l.id = p.contacto_id
   WHERE p.estado NOT IN ('Captado', 'Perdido')
  UNION ALL
  SELECT 'lead', l.id::text, l.agente_id,
         COALESCE(NULLIF(btrim(l.nombre || ' ' || COALESCE(l.apellidos, '')), ''), 'Sin nombre'),
         NULL, l.telefono,
         l.proximo_toque, l.proximo_motivo, l.atendido_en, l.estado, l.fecha_creacion
    FROM public.leads l
   WHERE l.duplicado_de IS NULL
     AND l.agente_id IS NOT NULL
     AND l.captacion_id IS NULL
     AND l.fuente IS DISTINCT FROM 'Captaciones'
     AND l.estado NOT IN ('Ganado', 'Perdido')
)
SELECT t.*,
       CASE
         WHEN t.proximo_toque IS NOT NULL AND t.proximo_toque <= now() THEN 0
         WHEN t.atendido_en IS NULL                                    THEN 1
         WHEN t.proximo_toque IS NOT NULL                              THEN 2
         ELSE 3
       END AS prioridad
  FROM todo t;


-- ------------------------------------------------------------
-- 6. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Cuántos leads esperan reparto (deberían ser ~136):
--   SELECT count(*) FROM public.leads
--    WHERE agente_id IS NULL AND duplicado_de IS NULL AND captacion_id IS NULL
--      AND fuente IS DISTINCT FROM 'Captaciones';
--
--   -- Repartir los 50 más antiguos:
--   --   SELECT * FROM public.repartir_leads_pendientes(50);
--
--   -- Y ver cómo quedaron repartidos entre el equipo:
--   --   SELECT p.nombre, count(*) FROM public.leads l
--   --     JOIN public.perfiles p ON p.id = l.agente_id
--   --    WHERE l.captacion_id IS NULL AND l.duplicado_de IS NULL
--   --    GROUP BY p.nombre ORDER BY 2 DESC;
--
--   -- La lista del día de cada agente:
--   --   SELECT ambito, count(*) FROM public.v_mi_dia GROUP BY ambito;
