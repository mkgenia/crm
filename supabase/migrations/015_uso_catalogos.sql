-- ============================================================
-- MIGRACIÓN 015: recuento de uso de los catálogos
--
-- La pantalla de catálogos enseña cuántas filas usan cada valor, que es lo que
-- permite archivar sin hacerlo a ciegas. La primera versión lo contaba trayendo
-- las filas de `leads`, `captaciones` y `lead_etiquetas` y sumándolas en
-- JavaScript — y PostgREST corta en 1.000 filas por defecto.
--
-- Con 1.034 leads el recuento YA estaría mal, y sin avisar: enseñaría números
-- más bajos de los reales, que en una pantalla cuya única función es decidir si
-- se puede archivar algo es el peor error posible. Se archivaría un estado que
-- parece tener 12 filas y en realidad tiene 300.
--
-- Contarlo en la base de datos lo arregla y además escala: un GROUP BY devuelve
-- cuarenta filas en vez de tres mil, y seguirá haciéndolo con cincuenta mil
-- leads.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.uso_catalogos()
RETURNS TABLE (clave text, total bigint)
LANGUAGE sql
STABLE
AS $$
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
   GROUP BY etiqueta_id;
$$;

-- Comprobación tras ejecutar:
--   SELECT * FROM public.uso_catalogos() ORDER BY total DESC LIMIT 10;
--   -- 'estado_lead:Contactado' debe rondar las 600 y 'fuente:Captaciones' las 870.
