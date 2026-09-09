-- ============================================================
-- MIGRACIÓN 004: zonas del captador configurables
--
-- Hasta ahora una zona era solo una URL de Idealista de venta de viviendas, con
-- la ventana de publicación fijada en el código del workflow. Eso obligaba a
-- tocar n8n para cualquier variación.
--
-- Motivo concreto: el mercado de locales es mucho más fino que el de vivienda
-- (13 anuncios en 48 h en toda Valencia, frente a 375 de vivienda), así que con
-- una ventana de 24 h esa zona no captaría nada. La ventana tiene que ser una
-- propiedad de cada zona, no una constante global.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

ALTER TABLE public.scraper_zonas
  ADD COLUMN IF NOT EXISTS ventana_horas  integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS operacion      text    NOT NULL DEFAULT 'venta',
  ADD COLUMN IF NOT EXISTS tipo_inmueble  text    NOT NULL DEFAULT 'viviendas';

COMMENT ON COLUMN public.scraper_zonas.ventana_horas IS
  'Antigüedad máxima del anuncio, en horas, que pide esta zona. 24 para mercados '
  'con mucho movimiento (vivienda); 48 o más para los finos (locales, garajes), '
  'donde con 24 h no saldría nada. El workflow la inyecta en el segmento /con-.../ '
  'de la URL, así que cada zona puede llevar la suya en el mismo run de Apify.';

COMMENT ON COLUMN public.scraper_zonas.operacion IS
  'venta | alquiler. Determina el segmento de la URL de Idealista y, sobre todo, '
  'el discurso del mensaje: a quien alquila se le ofrecen inquilinos solventes, '
  'no compradores.';

COMMENT ON COLUMN public.scraper_zonas.tipo_inmueble IS
  'viviendas | locales | garajes | oficinas | terrenos | trasteros. Cambia el '
  'segmento de la URL y el vocabulario del mensaje: a quien vende una nave no se '
  'le habla de "su piso" ni de plantas sin ascensor.';

-- Rellenar las zonas existentes a partir de su URL, para no perder coherencia
UPDATE public.scraper_zonas
SET operacion = CASE WHEN url LIKE '%/alquiler-%' THEN 'alquiler' ELSE 'venta' END,
    tipo_inmueble = CASE
      WHEN url LIKE '%-locales/%'   THEN 'locales'
      WHEN url LIKE '%-garajes/%'   THEN 'garajes'
      WHEN url LIKE '%-oficinas/%'  THEN 'oficinas'
      WHEN url LIKE '%-terrenos/%'  THEN 'terrenos'
      WHEN url LIKE '%-trasteros/%' THEN 'trasteros'
      ELSE 'viviendas'
    END,
    ventana_horas = COALESCE(
      NULLIF(substring(url from 'publicado_ultimas-(\d+)-horas'), '')::integer,
      24
    );

-- Rangos admitidos, para que un valor absurdo no dispare el gasto.
--
-- La segunda condición sale de una prueba, no de una suposición: la sección de
-- alquiler de Idealista NO tiene ventana de 48 h. Con el mismo actor, el mismo
-- día y la misma ciudad, /alquiler-viviendas/valencia-valencia/con-publicado_
-- ultimas-48-horas/ devolvió cero dos veces seguidas, mientras la de 24 h
-- devolvía anuncios y la de venta a 48 h también. Una zona de alquiler a 48 h
-- sería una zona muda: mejor que la base no la deje guardar.
ALTER TABLE public.scraper_zonas DROP CONSTRAINT IF EXISTS scraper_zonas_ventana_check;
ALTER TABLE public.scraper_zonas
  ADD CONSTRAINT scraper_zonas_ventana_check
  CHECK (ventana_horas IN (24, 48) AND NOT (operacion = 'alquiler' AND ventana_horas <> 24));

ALTER TABLE public.scraper_zonas DROP CONSTRAINT IF EXISTS scraper_zonas_operacion_check;
ALTER TABLE public.scraper_zonas
  ADD CONSTRAINT scraper_zonas_operacion_check CHECK (operacion IN ('venta', 'alquiler'));

-- Ojo con el nombre: `scraper_zonas_tipo_check` YA EXISTE y es el de la columna
-- `tipo` (nombre|zona). Llamar igual al de `tipo_inmueble` lo habría sustituido en
-- silencio y la columna `tipo` se habría quedado sin validar.
ALTER TABLE public.scraper_zonas DROP CONSTRAINT IF EXISTS scraper_zonas_tipo_inmueble_check;
ALTER TABLE public.scraper_zonas
  ADD CONSTRAINT scraper_zonas_tipo_inmueble_check
  CHECK (tipo_inmueble IN ('viviendas', 'locales', 'garajes', 'oficinas', 'terrenos', 'trasteros'));

-- Las zonas de alquiler que hubiera guardadas a 48 h no captaban nada; se
-- corrigen antes de que el CHECK las rechace.
UPDATE public.scraper_zonas
SET ventana_horas = 24
WHERE operacion = 'alquiler' AND ventana_horas <> 24;

-- El formulario ahora deja pegar una URL de Idealista tal cual ('url'), además
-- del polígono ('zona'). Se admite 'nombre' porque hay filas antiguas así, pero
-- esa opción ya no se ofrece: generaba URLs /buscar/?q=… que el scraper no sabe
-- recorrer (devuelve "No results found" con ventana y sin ella, mientras el mismo
-- barrio por polígono sí capta).
ALTER TABLE public.scraper_zonas DROP CONSTRAINT IF EXISTS scraper_zonas_tipo_check;
ALTER TABLE public.scraper_zonas
  ADD CONSTRAINT scraper_zonas_tipo_check CHECK (tipo IN ('nombre', 'zona', 'url'));

-- La zona de locales se creó como 'zona' porque el CHECK viejo no admitía 'url'.
-- Una zona de polígono sin polígono no es tal: se reetiqueta.
UPDATE public.scraper_zonas SET tipo = 'url' WHERE tipo = 'zona' AND coords IS NULL;

-- ============================================================
-- El trigger de "una sola zona activa"
--
-- Descubierto probándolo: al activar la zona de locales, la de viviendas se
-- desactivó sola. Hay un trigger que apaga las demás filas cada vez que se
-- activa una.
--
-- Eso venía del diseño viejo, cuando cada zona era un run de Apify y tener dos
-- activas costaba el doble. Ya no: el scraper mete TODAS las zonas activas en el
-- mismo run, así que el arranque del actor ($0.007) se paga una sola vez tanto
-- si hay una zona como si hay cuatro. Con el trigger puesto, no se puede tener
-- viviendas y locales a la vez, que es justo lo que se quiere.
--
-- Se borran solo los triggers cuya función apague `activa`, para no llevarse por
-- delante uno de `updated_at` o similar. Cada uno que se borre se anuncia.
-- ============================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, p.oid AS fn_oid, p.proname
    FROM pg_trigger tg
    JOIN pg_class rel ON rel.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE ns.nspname = 'public'
      AND rel.relname = 'scraper_zonas'
      AND NOT tg.tgisinternal
      AND p.prosrc ~* 'activa'
      AND p.prosrc ~* 'false'
  LOOP
    RAISE NOTICE 'Borrando trigger % (función %)', t.tgname, t.proname;
    EXECUTE format('DROP TRIGGER %I ON public.scraper_zonas', t.tgname);
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', t.fn_oid::regprocedure);
  END LOOP;
END $$;

-- Comprobación tras ejecutar:
--   SELECT nombre, activa, operacion, tipo_inmueble, ventana_horas, url
--   FROM public.scraper_zonas ORDER BY activa DESC, id;
--
-- Y la que de verdad importa, que ya no se apaguen entre ellas:
--   UPDATE public.scraper_zonas SET activa = true;
--   SELECT nombre, activa FROM public.scraper_zonas;   -- deben quedar TODAS activas
--   UPDATE public.scraper_zonas SET activa = false WHERE nombre = 'Valencia Test';
