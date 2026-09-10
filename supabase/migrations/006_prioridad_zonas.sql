-- ============================================================
-- MIGRACIÓN 006: prioridad entre zonas
--
-- Hasta ahora todas las zonas activas viajaban juntas en el mismo run de Apify
-- con un tope de anuncios COMPARTIDO. Eso tenía dos problemas: la zona grande se
-- comía el cupo y la pequeña se truncaba sin avisar, y no había forma de saber
-- qué había aportado cada una.
--
-- Ahora cada pasada rápida lleva UNA zona, elegida por prioridad. El arranque del
-- actor cuesta lo mismo (se paga uno por pasada de todas formas), el tope entero
-- es para ella, y el recuento por zona pasa a ser un hecho en vez de una
-- deducción por tipo de inmueble.
--
-- El reparto es por peso, no excluyente: la 1ª se lleva el doble de pasadas que
-- la 2ª, ésta el doble que la 3ª, y así. Con cuatro zonas y 26 pasadas al día
-- sale 16 / 6 / 2 / 2. Ninguna se queda a cero, que es lo que pasaría con un
-- orden estricto: mientras se barre el fondo del catálogo se dejaría de captar lo
-- recién publicado, que es lo que más convierte.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

ALTER TABLE public.scraper_zonas
  ADD COLUMN IF NOT EXISTS prioridad integer NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.scraper_zonas.prioridad IS
  'Orden de atención: 1 = primera. Decide cuántas pasadas del día se lleva cada '
  'zona (la primera el doble que la segunda, y así sucesivamente). Las zonas sin '
  'prioridad asignada van al final. La red de seguridad de las 07:00 las lleva '
  'todas juntas e ignora este orden.';

-- Prioridad inicial: rezagados primero, luego locales, luego lo nuevo y el
-- alquiler. Es lo que pidió Josep. Sólo se aplica a las que aún están en el
-- valor por defecto, para no pisar un orden ya elegido a mano.
UPDATE public.scraper_zonas SET prioridad = 1 WHERE prioridad = 100 AND nombre ILIKE '%rezagados%';
UPDATE public.scraper_zonas SET prioridad = 2 WHERE prioridad = 100 AND tipo_inmueble = 'locales';
UPDATE public.scraper_zonas SET prioridad = 3 WHERE prioridad = 100 AND operacion = 'venta' AND tipo_inmueble = 'viviendas';
UPDATE public.scraper_zonas SET prioridad = 4 WHERE prioridad = 100 AND operacion = 'alquiler';

-- Comprobación tras ejecutar:
--   SELECT prioridad, nombre, activa, operacion, tipo_inmueble, ventana_horas
--   FROM public.scraper_zonas ORDER BY prioridad, nombre;
--
-- Para reordenar a mano:
--   UPDATE public.scraper_zonas SET prioridad = 1 WHERE nombre = 'Alquiler viviendas Valencia';
