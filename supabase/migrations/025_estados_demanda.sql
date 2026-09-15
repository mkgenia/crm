-- ============================================================
-- MIGRACIÓN 025: los estados de la demanda, al catálogo
--
-- Eran la última lista de estados escrita a mano del CRM. Vivían en
-- `src/types/demandas.ts` como un array y un mapa de colores, así que crear un
-- estado nuevo de demanda exigía tocar código y desplegar — justo lo que la 012
-- vino a quitar.
--
-- `sistema = true` porque el valor 'Nuevo' lo escribe el workflow que da de alta
-- las demandas desde el correo de los portales (`/api/demandas/nueva`).
-- Renombrarlos y recolorearlos, sí; borrarlos, no: rompería esa entrada.
--
-- Los colores son los mismos tonos que tenía la pantalla, para que el cambio no
-- se note al mirarla. Salen de la paleta cerrada de `src/lib/catalogos.ts`
-- (slate, gray, sky, cyan, violet, indigo, emerald, amber, rose, pink). Ojo: no
-- existe `orange` — ya me equivoqué con eso en la 019 y el color salía gris.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema) VALUES
  ('estado_demanda', 'Nuevo',       'Nuevo',       'violet',  10, true, true),
  ('estado_demanda', 'Contactado',  'Contactado',  'cyan',    20, true, true),
  ('estado_demanda', 'Cualificado', 'Cualificado', 'emerald', 30, true, true),
  ('estado_demanda', 'Descartado',  'Descartado',  'gray',    40, true, true)
ON CONFLICT (tipo, valor) DO NOTHING;

-- ------------------------------------------------------------
-- Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   SELECT valor, nombre, color FROM public.catalogos
--    WHERE tipo = 'estado_demanda' ORDER BY orden;
--
--   -- Y que no haya demandas con un estado que no esté catalogado:
--   SELECT DISTINCT d.estado FROM public.demandas d
--    WHERE d.estado IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.catalogos c
--                       WHERE c.tipo = 'estado_demanda' AND c.valor = d.estado);
