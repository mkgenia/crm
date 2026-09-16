-- ============================================================
-- MIGRACIÓN 035: cuándo entró y cuándo me llegó, que no es lo mismo
--
-- DE DÓNDE SALE ESTO.
-- El dueño asignó una captación de hace seis días y en la lista del agente leyó
-- "entró hace 6 días". Pensó que algo estaba mal —que el lead no se había
-- movido— hasta que cayó en la cuenta de que esa fecha es CUÁNDO ENTRÓ, no
-- cuándo se la dieron a nadie. Y entonces pidió lo sensato:
--
--   "podriamos indicar cuando entro el lead y cuando se asigno? y cuando este en
--    automatico y tal se pondra automatico la misma hora"
--
-- Tiene razón en las dos cosas. Son dos preguntas distintas —"¿cuánto lleva esta
-- persona esperando?" y "¿cuánto llevo yo sin llamarla?"— y con una sola fecha
-- no se puede contestar a las dos. Y sí: en reparto automático las dos horas
-- coinciden, porque el trigger asigna en la misma transacción en la que entra.
--
-- Comprobado antes de escribir esto: los cuatro caminos de reparto automático
-- —017:179, 020:75, 024:196 y 027:158— escriben `asignado_en = now()`. O sea que
-- el dato existe y se rellena solo de ahora en adelante.
--
-- LO QUE NO SE PUEDE ARREGLAR HACIA ATRÁS, y hay que saberlo:
--   captaciones con agente ...... 63,  con `asignado_en` ...... 3
--   leads con agente ............ 67,  con `asignado_en` ...... 12
-- El resto se asignaron antes de que la columna existiera. Esa fecha no está en
-- ninguna parte y no se puede deducir: la pantalla tiene que saber decir "no
-- consta" en vez de inventarse una.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La vista, con la fecha de asignación
--
-- `asignado_en` VA LA ÚLTIMA, detrás de `fuente`. Es la misma regla con la que
-- tropezó la 033: CREATE OR REPLACE VIEW exige que las columnas que ya existían
-- conserven nombre, tipo Y POSICIÓN, y sólo deja añadir al final. Meterla en
-- medio corta con:
--
--     ERROR: 42P16: cannot change name of view column "..." to "asignado_en"
--
-- Y por eso el SELECT nombra las columnas una a una en vez de usar `t.*`: con el
-- asterisco el orden lo decide el CTE de arriba, y el día que alguien añada un
-- campo en medio del UNION se encuentra el mismo error sin saber de dónde sale.
--
-- QUÉ ES "ASIGNADO" EN CADA ÁMBITO:
--   · captación -> `c.asignado_en`, que es lo que escriben los cuatro repartos.
--   · lead      -> `l.asignado_en`, igual.
--   · prospecto -> la tabla `prospectos` NO tiene esa columna (022). Un prospecto
--                  nace al promocionar una captación que ya era de alguien, así
--                  que el momento en que pasó a ser suyo ES su `created_at`.
--                  No es un apaño: es literalmente cuándo empezó a ser trabajo de
--                  ese agente.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mi_dia WITH (security_invoker = true) AS
WITH todo AS (
  SELECT 'captacion'::text AS ambito, c.id::text AS id, c.agente_id,
         COALESCE(c.calle, c.nombre) AS titulo, c.barrio, c.telefono,
         c.proximo_toque, c.proximo_motivo, c.atendido_en,
         COALESCE(c.senal, c.estado_whatsapp) AS senal, c.created_at AS entro_en,
         'Captaciones'::text AS fuente,
         c.asignado_en
    FROM public.captaciones c
   WHERE c.activo AND c.prospecto_id IS NULL AND c.agente_id IS NOT NULL
  UNION ALL
  SELECT 'prospecto', p.id::text, p.agente_id,
         COALESCE(p.direccion, l.nombre), p.barrio, l.telefono,
         p.proximo_toque, p.proximo_motivo, p.atendido_en, p.estado, p.created_at,
         COALESCE(l.fuente, 'Captaciones'),
         p.created_at
    FROM public.prospectos p
    JOIN public.leads l ON l.id = p.contacto_id
   WHERE p.estado NOT IN ('Captado', 'Perdido')
  UNION ALL
  SELECT 'lead', l.id::text, l.agente_id,
         COALESCE(NULLIF(btrim(l.nombre || ' ' || COALESCE(l.apellidos, '')), ''), 'Sin nombre'),
         NULL, l.telefono,
         l.proximo_toque, l.proximo_motivo, l.atendido_en, l.estado, l.fecha_creacion,
         l.fuente,
         l.asignado_en
    FROM public.leads l
   WHERE l.duplicado_de IS NULL
     AND l.agente_id IS NOT NULL
     AND l.captacion_id IS NULL
     AND l.fuente IS DISTINCT FROM 'Captaciones'
     AND l.estado NOT IN ('Ganado', 'Perdido')
)
SELECT t.ambito,
       t.id,
       t.agente_id,
       t.titulo,
       t.barrio,
       t.telefono,
       t.proximo_toque,
       t.proximo_motivo,
       t.atendido_en,
       t.senal,
       t.entro_en,
       CASE
         WHEN t.proximo_toque IS NOT NULL AND t.proximo_toque <= now() THEN 0
         WHEN t.atendido_en IS NULL                                    THEN 1
         WHEN t.proximo_toque IS NOT NULL                              THEN 2
         ELSE 3
       END AS prioridad,
       t.fuente,
       -- La nueva, y por eso la última. Ver el comentario de arriba.
       t.asignado_en
  FROM todo t;

COMMENT ON VIEW public.v_mi_dia IS
  'Lo que un agente tiene encima de la mesa: captaciones, prospectos y leads en una sola lista, ordenables por `prioridad` (0 vencido, 1 sin tocar nunca, 2 con cita, 3 el resto). Desde la 033 devuelve `fuente`; desde la 035, `asignado_en` — cuándo pasó a ser de ese agente, que no es lo mismo que `entro_en`, cuándo entró en el CRM. En reparto automático las dos coinciden.';


-- ------------------------------------------------------------
-- 2. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- EL ORDEN, que es lo que hizo fallar a la 033 en su primer intento.
--   -- Las trece primeras igual que estaban y `asignado_en` la catorce:
--   SELECT ordinal_position, column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'v_mi_dia'
--    ORDER BY ordinal_position;
--   --  1 ambito · 2 id · 3 agente_id · 4 titulo · 5 barrio · 6 telefono
--   --  7 proximo_toque · 8 proximo_motivo · 9 atendido_en · 10 senal
--   -- 11 entro_en · 12 prioridad · 13 fuente · 14 asignado_en
--
--   -- Cuántas filas saben cuándo se asignaron, por ámbito. Hoy saldrán pocas
--   -- en captacion y lead (3 y 12) y TODAS en prospecto, porque ahí la fecha
--   -- es su created_at:
--   SELECT ambito,
--          count(*) AS filas,
--          count(asignado_en) AS con_fecha,
--          count(*) - count(asignado_en) AS sin_fecha
--     FROM public.v_mi_dia GROUP BY ambito ORDER BY ambito;
--
--   -- Y que no ha cambiado nada más: el total y el reparto por prioridad tienen
--   -- que ser los mismos que antes de ejecutar.
--   SELECT count(*) FROM public.v_mi_dia;
--   SELECT prioridad, count(*) FROM public.v_mi_dia GROUP BY prioridad ORDER BY prioridad;
--
--   -- La diferencia entre las dos fechas, que es lo que se quería ver:
--   SELECT titulo,
--          entro_en::date      AS entro,
--          asignado_en::date   AS se_asigno,
--          CASE WHEN asignado_en IS NULL THEN 'no consta'
--               WHEN date_trunc('minute', entro_en) = date_trunc('minute', asignado_en)
--                 THEN 'a la vez (reparto automático)'
--               ELSE (asignado_en::date - entro_en::date) || ' días después'
--          END AS cuanto_tardo
--     FROM public.v_mi_dia ORDER BY entro_en DESC LIMIT 15;
