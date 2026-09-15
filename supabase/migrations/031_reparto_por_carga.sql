-- ============================================================
-- MIGRACIÓN 031: el turno mira lo que lleva cada uno
--
-- POR QUÉ.
-- El panel de reparto enseña la carga de cada agente, y el motor la ignoraba:
-- repartía por orden estricto de turno. Medido hoy sobre el equipo real:
--
--   Ana        23 captaciones o prospectos abiertos
--   Cristina   19
--   Raul       10
--   Placido     9
--   Amparo      2
--
-- Con turno estricto, a Ana y a Placido les toca alternativamente, y la
-- diferencia de 21 no se corrige nunca: sólo crece. El dato estaba a la vista y
-- no servía para nada, que es lo peor que le puede pasar a un número.
--
-- QUÉ CAMBIA.
-- Una regla nueva, `carga`, que se enciende desde el panel como las otras dos
-- (`continuidad` y `zona`). Con ella puesta, entre los que están disponibles y
-- no han rechazado, se elige AL QUE MENOS LLEVA. El turno sigue existiendo y
-- sigue decidiendo los empates, así que dos agentes con la misma carga se
-- alternan como hasta ahora.
--
-- NACE APAGADA. Encenderla cambia a quién le toca el siguiente lead, y eso es
-- una decisión del que dirige el equipo, no de una migración. El panel la
-- ofrece; nadie la activa por sorpresa.
--
-- LA CONTINUIDAD SIGUE MANDANDO. Si ya hablamos con ese teléfono, va al mismo
-- agente aunque vaya cargado: partir una conversación entre dos personas cuesta
-- más que un reparto desigual.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Lo que lleva abierto cada agente
--
-- Se cuenta sobre `v_mi_dia`, que es LA MISMA vista que el agente abre por la
-- mañana. Así el número que decide el reparto y el número que ve el comercial
-- no pueden separarse nunca: si un día discrepan, es que la vista cambió, y
-- cambian los dos a la vez.
--
-- Hoy esto ya se contaba así en el panel (asignacion.ts) pero sólo para
-- pintarlo. Ahora además decide.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.carga_abierta(p_agente uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)::integer FROM public.v_mi_dia d WHERE d.agente_id = p_agente;
$fn$;

COMMENT ON FUNCTION public.carga_abierta(uuid) IS
  'Cuántas cosas abiertas lleva un agente: captaciones, prospectos y leads juntos. Se cuenta sobre v_mi_dia, la misma vista que ve el propio agente.';


-- ------------------------------------------------------------
-- 2. El motor, con la regla nueva
--
-- La firma NO cambia: cambiarla crearía una segunda función y las llamadas por
-- nombre quedarían ambiguas ('function is not unique'). Los triggers de la 020
-- y la 024 y las dos RPC de reparto la llaman así.
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
  v_por_carga   boolean;
  v_anterior    uuid;
  v_elegido     uuid;
  v_orden       integer;
  v_carga       integer;
  v_tel         text := public.normalizar_telefono(p_telefono);
BEGIN
  IF p_cursor IS NOT NULL THEN
    v_cursor := p_cursor;
  ELSE
    SELECT COALESCE((value #>> '{}')::integer, 0) INTO v_cursor
      FROM public.app_settings WHERE key = 'asignacion_cursor';
  END IF;
  v_cursor := COALESCE(v_cursor, 0);

  SELECT COALESCE((value -> 'continuidad')::boolean, true),
         COALESCE((value -> 'carga')::boolean, false)
    INTO v_continuidad, v_por_carga
    FROM public.app_settings WHERE key = 'asignacion_reglas';
  v_continuidad := COALESCE(v_continuidad, true);
  v_por_carga   := COALESCE(v_por_carga, false);

  -- La continuidad manda sobre todo lo demás, incluida la carga: si esa persona
  -- ya la lleva alguien, sigue siendo suya. Partir una conversación entre dos
  -- agentes cuesta más que un reparto desigual.
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

  -- ---- POR CARGA ----
  -- El que menos lleva. El turno decide los empates, así que dos agentes con la
  -- misma carga se siguen alternando y nadie se queda parado.
  IF v_por_carga THEN
    SELECT p.id, p.orden_reparto, public.carga_abierta(p.id)
      INTO v_elegido, v_orden, v_carga
      FROM public.perfiles p
     WHERE p.rol <> 'Admin'
       AND p.disponible
       AND p.orden_reparto IS NOT NULL
       AND NOT (p.id = ANY (p_rechazado_por))
     ORDER BY public.carga_abierta(p.id) ASC, p.orden_reparto ASC
     LIMIT 1;

    IF v_elegido IS NOT NULL THEN
      RETURN QUERY SELECT v_elegido,
        ('Por carga: lleva ' || v_carga || ' abiertos, el que menos')::text,
        -- El cursor NO se toca: con esta regla el turno sólo desempata, y
        -- moverlo haría que al apagarla la rotación arrancara en un punto
        -- arbitrario.
        v_cursor;
      RETURN;
    END IF;
  END IF;

  -- ---- POR TURNO (lo de siempre) ----
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
-- 3. La regla, apagada, en los ajustes
--
-- Se añade sin pisar lo que ya haya: `||` sobre el jsonb conserva `continuidad`
-- y `zona` tal y como estén.
-- ------------------------------------------------------------
UPDATE public.app_settings
   SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object('carga', false),
       updated_at = now()
 WHERE key = 'asignacion_reglas'
   AND NOT (COALESCE(value, '{}'::jsonb) ? 'carga');

INSERT INTO public.app_settings (key, value)
SELECT 'asignacion_reglas', '{"continuidad": true, "zona": false, "especialidad": false, "carga": false}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'asignacion_reglas');


-- ------------------------------------------------------------
-- 4. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- La carga real de cada uno, que es lo que decidirá el reparto:
--   SELECT p.nombre, public.carga_abierta(p.id) AS abiertos, p.orden_reparto
--     FROM public.perfiles p
--    WHERE p.rol <> 'Admin' AND p.orden_reparto IS NOT NULL
--    ORDER BY abiertos;
--
--   -- Con la regla APAGADA (como nace), sigue mandando el turno:
--   SELECT * FROM public.siguiente_agente('+34600000000');
--   -- motivo: "Turno de reparto"
--
--   -- Encenderla y volver a preguntar:
--   --   UPDATE public.app_settings
--   --      SET value = value || '{"carga": true}'::jsonb
--   --    WHERE key = 'asignacion_reglas';
--   --   SELECT * FROM public.siguiente_agente('+34600000000');
--   --   -- motivo: "Por carga: lleva N abiertos, el que menos"
--   --
--   -- Y apagarla otra vez:
--   --   UPDATE public.app_settings
--   --      SET value = value || '{"carga": false}'::jsonb
--   --    WHERE key = 'asignacion_reglas';
