-- ============================================================
-- MIGRACIÓN 005: modo barrido en las zonas, y control de ritmo de la cola
--
-- 1) BARRIDO (ventana_horas = 0)
--    Hasta ahora cada zona pedía a Idealista solo lo publicado en las últimas
--    24 o 48 h. Eso limita el conjunto a lo de hoy: por eso las pasadas rápidas
--    devolvían 8 o 16 anuncios y no había nada más al fondo a lo que avanzar.
--
--    Con ventana_horas = 0 la URL va SIN filtro de fecha y ordenada por
--    publicación descendente, y es `monitoringMode` quien descarta lo ya emitido.
--    Comprobado antes de montarlo: dos pasadas idénticas seguidas devolvieron 40
--    anuncios cada una con CERO repetidos, y la segunda ya llegaba a 5 días de
--    antigüedad. Así el captador recorre el catálogo entero poco a poco, y un
--    anuncio publicado hoy entra en la siguiente pasada porque sale el primero.
--
--    Ojo: la red de seguridad de las 07:00 NO se aplica a las zonas de barrido.
--    Reemitir "todo" sin ventana sería el catálogo entero de Valencia cada
--    mañana. El scraper las excluye por su cuenta.
--
-- 2) RITMO DE LA COLA (wa_ritmo)
--    normal (por defecto) · rápido · turbo. Cambia cuántos turnos se saltan y
--    cuánto se espera antes de enviar. 'turbo' es para vaciar una cola acumulada
--    un día concreto: sin salto aleatorio los envíos salen a intervalos idénticos,
--    que es la firma que delata un automatismo ante WhatsApp.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ---------- 1. Barrido ----------
ALTER TABLE public.scraper_zonas DROP CONSTRAINT IF EXISTS scraper_zonas_ventana_check;
ALTER TABLE public.scraper_zonas
  ADD CONSTRAINT scraper_zonas_ventana_check
  CHECK (
    ventana_horas IN (0, 24, 48)
    -- En alquiler Idealista no ofrece la ventana de 48 h: esa URL devuelve cero
    -- anuncios (probado dos veces). Se admite 24 h o barrido completo.
    AND NOT (operacion = 'alquiler' AND ventana_horas = 48)
  );

COMMENT ON COLUMN public.scraper_zonas.ventana_horas IS
  '0 = barrido: sin filtro de fecha, ordenado por publicación descendente, y es '
  'monitoringMode quien descarta lo ya emitido, de modo que cada pasada avanza '
  'hacia el fondo del catálogo. 24/48 = solo lo publicado en esa ventana. '
  'La red de seguridad de las 07:00 ignora las zonas de barrido.';

-- ---------- 2. Ritmo de la cola ----------
INSERT INTO public.app_settings (key, value)
VALUES ('wa_ritmo', '"normal"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Comprobación tras ejecutar:
--   SELECT nombre, activa, operacion, tipo_inmueble, ventana_horas FROM public.scraper_zonas ORDER BY nombre;
--   SELECT key, value FROM public.app_settings WHERE key LIKE 'wa_%';
--
-- Para poner una zona en barrido:
--   UPDATE public.scraper_zonas SET ventana_horas = 0 WHERE nombre = 'Valencia 2';
--
-- Para acelerar la cola un rato (y acordarse de devolverla a 'normal'):
--   UPDATE public.app_settings SET value = '"turbo"'::jsonb WHERE key = 'wa_ritmo';
