-- ============================================================
-- MIGRACIÓN 023: que el recuento de uso cuente TODOS los catálogos
--
-- POR QUÉ.
-- `uso_catalogos()` es de la migración 015 y contaba los cuatro catálogos que
-- existían entonces. Desde entonces han entrado cinco más —tipo_interaccion y
-- motivo_perdida (018), especialidad y zona (013), estado_prospecto (022)— y a
-- todos ellos la pantalla de catálogos les enseña 0.
--
-- No es cosmético. Esa pantalla usa ese número para decidir si algo se puede
-- archivar sin romper nada. Medido hoy: 'tipo_interaccion / reentrada' tiene 60
-- filas y la pantalla dice 0. Alguien lo archivaría pensando que no lo usa
-- nadie, que es exactamente el error que la 015 decía venir a evitar:
--
--   "en una pantalla cuya única función es decidir si se puede archivar algo,
--    es el peor error posible"
--
-- Y ahora molesta más que antes, porque acabamos de sacar esos catálogos a la
-- interfaz para poder editarlos.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.uso_catalogos()
RETURNS TABLE (clave text, total bigint)
LANGUAGE sql
STABLE
AS $fn$
  -- Los cuatro de siempre
  SELECT 'estado_lead:' || estado, count(*)
    FROM public.leads WHERE estado IS NOT NULL AND estado <> ''
   GROUP BY estado
  UNION ALL
  SELECT 'fuente:' || fuente, count(*)
    FROM public.leads WHERE fuente IS NOT NULL AND fuente <> ''
   GROUP BY fuente
  UNION ALL
  SELECT 'estado_whatsapp:' || estado_whatsapp, count(*)
    FROM public.captaciones WHERE estado_whatsapp IS NOT NULL AND estado_whatsapp <> ''
   GROUP BY estado_whatsapp
  UNION ALL
  SELECT 'tipo_agenda:' || tipo, count(*)
    FROM public.agenda WHERE tipo IS NOT NULL AND tipo <> ''
   GROUP BY tipo
  UNION ALL
  -- Las etiquetas se cuentan por id y no por valor: `lead_etiquetas` guarda la
  -- clave ajena a `catalogos`, no el texto.
  SELECT 'id:' || etiqueta_id::text, count(*)
    FROM public.lead_etiquetas
   GROUP BY etiqueta_id

  -- ---- los que faltaban ----
  UNION ALL
  SELECT 'tipo_interaccion:' || tipo, count(*)
    FROM public.interacciones WHERE tipo IS NOT NULL AND tipo <> ''
   GROUP BY tipo
  UNION ALL
  SELECT 'motivo_perdida:' || motivo_perdida, count(*)
    FROM public.leads WHERE motivo_perdida IS NOT NULL AND motivo_perdida <> ''
   GROUP BY motivo_perdida
  UNION ALL
  -- El resultado de una llamada vive dentro del jsonb de la interacción, que es
  -- donde lo deja atender(). Se cuenta igual.
  SELECT 'resultado_atencion:' || (meta ->> 'resultado'), count(*)
    FROM public.interacciones WHERE meta ->> 'resultado' IS NOT NULL
   GROUP BY meta ->> 'resultado'
  UNION ALL
  SELECT 'estado_prospecto:' || estado, count(*)
    FROM public.prospectos WHERE estado IS NOT NULL AND estado <> ''
   GROUP BY estado
  UNION ALL
  SELECT 'motivo_perdida_prospecto:' || motivo_perdida, count(*)
    FROM public.prospectos WHERE motivo_perdida IS NOT NULL AND motivo_perdida <> ''
   GROUP BY motivo_perdida

  -- Especialidades y zonas son arrays en `perfiles`: se desdoblan con unnest
  -- para contar cuántos agentes llevan cada una.
  UNION ALL
  SELECT 'especialidad:' || e, count(*)
    FROM public.perfiles p, unnest(COALESCE(p.especialidades, '{}')) AS e
   GROUP BY e
  UNION ALL
  SELECT 'zona:' || z, count(*)
    FROM public.perfiles p, unnest(COALESCE(p.zonas, '{}')) AS z
   GROUP BY z;
$fn$;

-- ------------------------------------------------------------
-- Comprobación tras ejecutar
-- ------------------------------------------------------------
--   -- 'tipo_interaccion:reentrada' debe rondar las 60, no 0:
--   SELECT * FROM public.uso_catalogos()
--    WHERE clave LIKE 'tipo_interaccion:%' ORDER BY total DESC;
--
--   -- Y ningún catálogo vivo debería quedarse sin su fila salvo que de verdad
--   -- no lo use nadie:
--   SELECT c.tipo, c.valor, COALESCE(u.total, 0) AS usos
--     FROM public.catalogos c
--     LEFT JOIN public.uso_catalogos() u ON u.clave = c.tipo || ':' || c.valor
--    WHERE c.activo ORDER BY c.tipo, c.orden;
