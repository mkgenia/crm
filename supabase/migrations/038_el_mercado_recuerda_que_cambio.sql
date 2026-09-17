-- ============================================================
-- MIGRACIÓN 038: el mercado recuerda qué cambió, y una sola regla dice si
-- un anuncio sigue publicado
--
-- DE DÓNDE SALE ESTO.
-- Desde el 17/09/2026 el captador (CAP 01) manda TODO lo que descarga de
-- Idealista, no sólo los particulares, a un workflow nuevo, "VAL 02 · Guardar en
-- mercado", que guarda en `mercado_inmuebles` las viviendas en venta de València
-- ciudad. Hasta hoy esa tabla sólo sabía el ÚLTIMO dato de cada anuncio. Josep
-- pidió dos cosas:
--   · cuando un anuncio que ya conocemos cambia, saber QUÉ cambió (precio,
--     descripción, fotos...), de qué a qué y cuándo;
--   · saber si cada anuncio sigue publicado.
--
-- LO QUE HABÍA (leído de producción el 17/09/2026).
-- `mercado_precio_historial` tiene 228 filas, del 04/08 al 14/09: 221 bajadas
-- y 7 subidas. Las escribía el nodo "Insert Historial" de VAL 01 copiando lo que
-- daba Apify, y sólo sabía de precio.
-- `mercado_inmuebles` tiene 2.156 filas: 1.455 activas y 701 dadas de baja. Esas
-- bajas las ponía el nodo "Supabase Bajas" con detectRemovedListings sobre
-- pasadas parciales (la última configuración: maxItems 500), sin haber mirado
-- la ciudad entera, en cinco tandas (26 el 03/08, 109 el 04/08, 139 el 10/08,
-- 125 el 24/08 y 302 el 14/09). No hay forma de saber cuántas siguen publicadas
-- de verdad.
--
-- QUÉ HACE.
--   1. `mercado_inmuebles` gana `descripcion`, `num_fotos`, `faltas_escaneo` y
--      `ultimo_escaneo`.
--   2. El historial gana `campo`, `valor_anterior` y `valor_nuevo`. Las 228
--      filas de siempre quedan como campo = 'precio'.
--   3. Un trigger apunta los cambios él solo, venga el UPDATE de donde venga.
--   4. `mercado_aplicar_escaneo()` es la ÚNICA que decide si un anuncio sigue
--      publicado, con el escaneo completo de los domingos.
--   3b. Otro trigger, antes de escribir, impide que una captura VIEJA pise una
--      nueva y que un campo que llega vacío borre lo que ya se sabía.
--
-- CUÁNTO VA A ESCRIBIR. Simulado sobre el rescate del captador con el mapeo
-- de VAL 02 (val02-mapeo.js tal cual, captura a captura en orden de vista_en;
-- 1.684 capturas de 1.507 anuncios de venta en València): sólo 2 de esos
-- anuncios estaban ya en la tabla, y entre capturas del mismo anuncio salen 23
-- cambios (8 de número de fotos, 5 de descripción, 3 de precio, 2 de
-- habitaciones, 2 de ascensor, 1 de baños, 1 de metros, 1 de tipo_detallado) más
-- 1 'publicado' de no a sí: una de las 701 bajas que el captador ha vuelto a ver.
-- Nada de ruido por planta u obra nueva, que hasta hoy se guardaban vacías.
-- (Una primera simulación daba 6 de descripción: comparaba sin quitar espacios.)
--
-- ANTES DE VOLVER A ACTIVAR VAL 01 (hoy está desactivado) HAY QUE QUITARLE:
--   · "Insert Historial". "Update Precio" escribe el precio nuevo y el trigger
--     ya apunta el cambio. Con los dos, cada bajada saldría DOS veces. La
--     comprobación 12 del final lo vigila.
--   · "Supabase Bajas". Es el método que dejó las 701 bajas dudosas. Las bajas
--     las decide ya la función del punto 4.
-- Y esta migración va ANTES de encender VAL 02: si el workflow manda
-- `descripcion` o `num_fotos` y la columna no existe, PostgREST rechaza el lote
-- entero (PGRST204).
--
-- RLS: NO DEPENDE DE LA 036 NI CHOCA CON ELLA. No crea ni toca políticas, así
-- que da igual el orden. n8n escribe como `service_role`, que se salta RLS; el
-- SQL Editor, como `postgres`, dueño de las tablas. El CRM no escribe en
-- mercado_*: sólo lee (src/lib/actions/valorador.ts; lo único que inserta y borra
-- es `valoraciones`). Por eso el trigger NO es SECURITY DEFINER: no le hace
-- falta, y así nadie escribe en el historial con más permisos de los que tiene.
-- Si algún día escribiera `authenticated`, la política de la 036 ya le deja.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Columnas nuevas en mercado_inmuebles
--
-- `descripcion` y `num_fotos` las rellena VAL 02. Las filas que ya hay se quedan
-- en null, y no pasa nada: el trigger no apunta el paso de null a un valor, así
-- que la primera vez que VAL 02 las vea no llena el historial.
--
-- `faltas_escaneo`: cuántos escaneos completos SEGUIDOS no han visto el anuncio.
-- Ojo al leerla a mano: si el anuncio lo ve otro workflow (VAL 02) entre dos
-- escaneos, aquí sigue poniendo 1 hasta el escaneo siguiente, que es quien la
-- corrige (a 0 si lo ve, y vuelve a empezar en 1 si no). Para decidir la baja
-- no importa: la función mira la fecha_ultima_vista antes de sumar.
--
-- `ultimo_escaneo`: cuándo empezó el último escaneo completo que contó esta fila
-- (la viera o la echara en falta). No estaba en el encargo, pero sin ella un
-- reintento de n8n aplicaría el mismo escaneo dos veces, y un piso que ha faltado
-- UNA vez acabaría de baja. Es el mismo fallo que dejó las 701. Ver punto 4.
-- ------------------------------------------------------------
ALTER TABLE public.mercado_inmuebles ADD COLUMN IF NOT EXISTS descripcion    text;
ALTER TABLE public.mercado_inmuebles ADD COLUMN IF NOT EXISTS num_fotos      integer;
ALTER TABLE public.mercado_inmuebles ADD COLUMN IF NOT EXISTS faltas_escaneo integer NOT NULL DEFAULT 0;
ALTER TABLE public.mercado_inmuebles ADD COLUMN IF NOT EXISTS ultimo_escaneo timestamptz;

-- Si `faltas_escaneo` ya existía creada a mano sin el NOT NULL, el ADD de arriba
-- no hace nada. Esto la deja igual que si la hubiera creado esta migración.
UPDATE public.mercado_inmuebles SET faltas_escaneo = 0 WHERE faltas_escaneo IS NULL;
ALTER TABLE public.mercado_inmuebles ALTER COLUMN faltas_escaneo SET DEFAULT 0;
ALTER TABLE public.mercado_inmuebles ALTER COLUMN faltas_escaneo SET NOT NULL;

COMMENT ON COLUMN public.mercado_inmuebles.descripcion    IS 'Texto del anuncio (propertyComment). Lo rellena VAL 02.';
COMMENT ON COLUMN public.mercado_inmuebles.num_fotos      IS 'Fotos del anuncio en la última captura. Lo rellena VAL 02.';
COMMENT ON COLUMN public.mercado_inmuebles.faltas_escaneo IS 'Escaneos completos seguidos que no han visto el anuncio. A la segunda, baja. Sólo lo toca mercado_aplicar_escaneo(), así que si VAL 02 ve el anuncio entre dos escaneos se corrige en el siguiente.';
COMMENT ON COLUMN public.mercado_inmuebles.ultimo_escaneo IS 'Inicio del último escaneo completo que contó esta fila. Impide aplicar dos veces el mismo escaneo.';


-- ------------------------------------------------------------
-- 2. El historial deja de ser sólo de precio
--
-- `campo` dice qué cambió: 'precio', 'publicado', 'descripcion', 'num_fotos'...
-- El DEFAULT 'precio' es a propósito: las 228 filas que ya hay son de precio, y
-- `attachCambios` (src/lib/actions/valorador.ts) ya se escribió pensando en esta
-- columna: pinta la pastilla con las filas de precio y se salta las demás. El CRM
-- no cambia nada.
--
-- `valor_anterior` y `valor_nuevo` van en texto porque cada campo es de un tipo.
-- En las filas de precio se rellenan también, para que una consulta sobre el
-- historial entero no tenga que mirar dos pares de columnas.
-- ------------------------------------------------------------
ALTER TABLE public.mercado_precio_historial ADD COLUMN IF NOT EXISTS campo          text NOT NULL DEFAULT 'precio';
ALTER TABLE public.mercado_precio_historial ADD COLUMN IF NOT EXISTS valor_anterior text;
ALTER TABLE public.mercado_precio_historial ADD COLUMN IF NOT EXISTS valor_nuevo    text;

UPDATE public.mercado_precio_historial SET campo = 'precio' WHERE campo IS NULL;
ALTER TABLE public.mercado_precio_historial ALTER COLUMN campo SET DEFAULT 'precio';
ALTER TABLE public.mercado_precio_historial ALTER COLUMN campo SET NOT NULL;

UPDATE public.mercado_precio_historial
   SET valor_anterior = precio_anterior::text,
       valor_nuevo    = precio_nuevo::text
 WHERE campo = 'precio'
   AND valor_anterior IS NULL
   AND valor_nuevo IS NULL
   AND (precio_anterior IS NOT NULL OR precio_nuevo IS NOT NULL);

-- Es exactamente la consulta del CRM: por anuncio, lo más nuevo primero. El
-- índice viejo `idx_precio_hist_id` (sólo idealista_id) queda de sobra, pero no
-- molesta y no se toca.
CREATE INDEX IF NOT EXISTS idx_precio_hist_id_fecha
  ON public.mercado_precio_historial (idealista_id, fecha DESC);


-- ------------------------------------------------------------
-- 3. El trigger que apunta QUÉ cambió
--
-- POR QUÉ UN TRIGGER. Los cambios entran por tres puertas: el upsert de VAL 02,
-- el "Update Precio" de VAL 01 y la función de escaneo del punto 4. El trigger
-- apunta venga de donde venga, y nadie tiene que acordarse de escribir en el
-- historial.
--
-- EL UPSERT DE n8n TAMBIÉN LO DISPARA. `Prefer: resolution=merge-duplicates` es
-- un INSERT ... ON CONFLICT DO UPDATE, y cuando el anuncio ya existe Postgres
-- lanza los triggers de UPDATE aunque los valores sean idénticos. Por eso cada
-- campo se compara de verdad antes de escribir: reescribir lo mismo no apunta
-- nada. Un anuncio nuevo (INSERT sin conflicto) tampoco.
--
-- AFTER Y NO BEFORE. Postgres ejecuta todos los BEFORE antes que cualquier
-- AFTER, sin importar el nombre. `trg_mercado_baja` (BEFORE) rellena o limpia
-- fecha_baja y precio_baja, y cuando llega éste la fila ya está escrita tal como
-- queda. Además, un AFTER no puede tocar la fila: sólo mira.
--
-- LO QUE NO SE APUNTA, a propósito:
--   · El paso de null a un valor o de un valor a null. Apify pone y quita campos
--     entre dos capturas del mismo anuncio (isAuction, isInTopFloor), y hasta hoy
--     planta y obra_nueva se guardaban siempre vacías por un fallo de mapeo. Con
--     esta regla, arreglar el mapeo o rellenar la descripción por primera vez no
--     inunda el historial. El precio es que si un campo pasa por null entre A y
--     B, ese cambio de A a B no queda apuntado.
--   · imagen_url (URL firmada que caduca y cambia en cada captura), las fechas,
--     precio_m2 (sale del precio y los metros), caracteristicas (el jsonb
--     repite lo que ya va en columnas), lat/lng/codbarrio/barrio, energia_kwh,
--     raw, faltas_escaneo y ultimo_escaneo.
--
-- LA DESCRIPCIÓN se compara sin espacios de más: dos capturas del mismo texto
-- pueden diferir sólo en saltos de línea. De las 3.891 capturas rescatadas con
-- descripción, 106 llevan espacio de no separación (chr 160), 20 su versión
-- estrecha (chr 8239) y 7 el separador de línea de Unicode (chr 8232), así que
-- se tratan como espacios. `[[:space:]]` solo no basta: según el locale de la
-- base, esos tres pueden no contar como espacio.
--
-- EL WHEN DEL TRIGGER. La función de escaneo del punto 4 hace UPDATE de unas
-- 6.000 filas cada domingo, y en casi todas sólo cambian fecha_ultima_vista,
-- faltas_escaneo y ultimo_escaneo. El WHEN mira primero, sin entrar en plpgsql,
-- si ha cambiado alguno de los campos vigilados; si no, la función ni se llama.
-- Es sólo un filtro: la función vuelve a comparar cada campo como se explica
-- arriba. Si se añade un campo a la lista de la función, hay que añadirlo
-- también al WHEN; la comprobación 14 del final avisa si se olvida. Efecto
-- secundario: mientras el trigger exista, Postgres no deja cambiar el TIPO de
-- esas columnas (el WHEN depende de ellas); hay que quitar el trigger, cambiar
-- y volver a ejecutar este punto.
--
-- ARREGLOS A MANO. Un UPDATE masivo desde el SQL Editor que corrija datos (por
-- ejemplo, normalizar estado_conservacion en todas las filas) también se apunta,
-- fila a fila, como si Idealista lo hubiera cambiado. Para eso:
--   ALTER TABLE public.mercado_inmuebles DISABLE TRIGGER trg_mercado_registrar_cambios;
--   ... el arreglo ...
--   ALTER TABLE public.mercado_inmuebles ENABLE TRIGGER trg_mercado_registrar_cambios;
-- todo en la misma ejecución, para que no se cuele una captura de VAL 02 entre medias.
--
-- CUÁNDO. Si el UPDATE trae una `fecha_ultima_vista` más reciente que la que
-- había, el cambio se vio en ese momento, y ésa es la fecha. Así el backfill del
-- rescate, con capturas del 08/09 al 17/09, deja cada cambio en su día y no todos
-- en el día en que se cargó (tiene que mandarse en orden de `vista_en`). Si no la
-- trae o la trae más vieja (un PATCH suelto, una baja del escaneo), la hora de
-- ahora.
--
-- EL PRECIO se apunta igual que las 228 filas de Apify, para que el CRM lo pinte
-- igual: direccion 'decrease' o 'increase' (son los dos valores que hay), delta
-- en euros y pct con DOS decimales. Apify los daba con dos (-4.49, -4.76) y el
-- CRM enseña el número tal cual; mezclar -4.5 y -4.49 en la misma columna no
-- aporta nada.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mercado_registrar_cambios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_espacios constant text := '[[:space:]' || chr(160) || chr(8239) || chr(8232) || chr(8233) || ']+';
  v_fecha   timestamptz;
  v_antes   jsonb;
  v_despues jsonb;
  v_campo   text;
  v_a       jsonb;
  v_b       jsonb;
BEGIN
  IF NEW.fecha_ultima_vista IS NOT NULL
     AND (OLD.fecha_ultima_vista IS NULL OR NEW.fecha_ultima_vista > OLD.fecha_ultima_vista) THEN
    v_fecha := least(NEW.fecha_ultima_vista, now());
  ELSE
    v_fecha := now();
  END IF;

  -- Precio
  IF OLD.precio IS NOT NULL AND NEW.precio IS NOT NULL AND OLD.precio <> NEW.precio THEN
    INSERT INTO public.mercado_precio_historial
      (idealista_id, campo, precio_anterior, precio_nuevo, delta, pct, direccion,
       valor_anterior, valor_nuevo, fecha)
    VALUES
      (NEW.idealista_id, 'precio', OLD.precio, NEW.precio, NEW.precio - OLD.precio,
       CASE WHEN OLD.precio <> 0
            THEN round((NEW.precio - OLD.precio) / OLD.precio * 100, 2) END,
       CASE WHEN NEW.precio < OLD.precio THEN 'decrease' ELSE 'increase' END,
       OLD.precio::text, NEW.precio::text, v_fecha);
  END IF;

  -- Publicado
  IF OLD.activo IS NOT NULL AND NEW.activo IS NOT NULL AND OLD.activo <> NEW.activo THEN
    INSERT INTO public.mercado_precio_historial
      (idealista_id, campo, valor_anterior, valor_nuevo, fecha)
    VALUES
      (NEW.idealista_id, 'publicado',
       CASE WHEN OLD.activo THEN 'si' ELSE 'no' END,
       CASE WHEN NEW.activo THEN 'si' ELSE 'no' END,
       v_fecha);
  END IF;

  -- Descripción. Si una de las dos es null (o sólo espacios), la comparación da
  -- null y no entra: es el paso de nada a algo, que no se apunta. La primera
  -- comparación, la de texto tal cual, ahorra las dos expresiones regulares
  -- cuando el texto no ha cambiado, que es casi siempre.
  IF OLD.descripcion <> NEW.descripcion
     AND NULLIF(btrim(regexp_replace(OLD.descripcion, v_espacios, ' ', 'g')), '')
      <> NULLIF(btrim(regexp_replace(NEW.descripcion, v_espacios, ' ', 'g')), '') THEN
    INSERT INTO public.mercado_precio_historial
      (idealista_id, campo, valor_anterior, valor_nuevo, fecha)
    VALUES
      (NEW.idealista_id, 'descripcion', OLD.descripcion, NEW.descripcion, v_fecha);
  END IF;

  -- El resto. Se comparan como jsonb, que compara los números por su valor
  -- (71 y 71.0 son lo mismo). Si se añade un campo a esta lista, añadirlo también
  -- al WHEN del trigger (justo debajo de esta función) y a la comprobación 7 del
  -- final. Los sí/no se apuntan como 'si'/'no', igual que 'publicado'.
  v_antes   := to_jsonb(OLD);
  v_despues := to_jsonb(NEW);

  FOREACH v_campo IN ARRAY ARRAY[
    'num_fotos', 'metros', 'usable_area', 'habitaciones', 'banos', 'planta',
    'ascensor', 'estado_conservacion', 'exterior', 'energia', 'piscina',
    'jardin', 'trastero', 'parking', 'terraza', 'aire', 'gastos_comunidad',
    'obra_nueva', 'tipo_detallado', 'anunciante', 'agencia_nombre'
  ]
  LOOP
    v_a := v_antes   -> v_campo;
    v_b := v_despues -> v_campo;

    CONTINUE WHEN v_a IS NULL OR v_b IS NULL
               OR jsonb_typeof(v_a) = 'null' OR jsonb_typeof(v_b) = 'null'
               OR v_a = v_b;

    INSERT INTO public.mercado_precio_historial
      (idealista_id, campo, valor_anterior, valor_nuevo, fecha)
    VALUES
      (NEW.idealista_id, v_campo,
       CASE WHEN jsonb_typeof(v_a) = 'boolean'
            THEN CASE WHEN v_a = 'true'::jsonb THEN 'si' ELSE 'no' END
            ELSE v_antes ->> v_campo END,
       CASE WHEN jsonb_typeof(v_b) = 'boolean'
            THEN CASE WHEN v_b = 'true'::jsonb THEN 'si' ELSE 'no' END
            ELSE v_despues ->> v_campo END,
       v_fecha);
  END LOOP;

  RETURN NULL;  -- En un AFTER lo que se devuelve no se usa.
END;
$fn$;

COMMENT ON FUNCTION public.mercado_registrar_cambios() IS
  'Apunta en mercado_precio_historial qué campo de un anuncio cambió, de qué a qué y cuándo. No apunta pasos de null a valor ni reescrituras idénticas. Migración 038.';

-- Los mismos campos que mira la función, en el mismo orden: precio, activo,
-- descripcion y la lista del FOREACH.
DROP TRIGGER IF EXISTS trg_mercado_registrar_cambios ON public.mercado_inmuebles;
CREATE TRIGGER trg_mercado_registrar_cambios
  AFTER UPDATE ON public.mercado_inmuebles
  FOR EACH ROW
  WHEN ((OLD.precio, OLD.activo, OLD.descripcion,
         OLD.num_fotos, OLD.metros, OLD.usable_area, OLD.habitaciones, OLD.banos, OLD.planta,
         OLD.ascensor, OLD.estado_conservacion, OLD.exterior, OLD.energia, OLD.piscina,
         OLD.jardin, OLD.trastero, OLD.parking, OLD.terraza, OLD.aire, OLD.gastos_comunidad,
         OLD.obra_nueva, OLD.tipo_detallado, OLD.anunciante, OLD.agencia_nombre)
        IS DISTINCT FROM
        (NEW.precio, NEW.activo, NEW.descripcion,
         NEW.num_fotos, NEW.metros, NEW.usable_area, NEW.habitaciones, NEW.banos, NEW.planta,
         NEW.ascensor, NEW.estado_conservacion, NEW.exterior, NEW.energia, NEW.piscina,
         NEW.jardin, NEW.trastero, NEW.parking, NEW.terraza, NEW.aire, NEW.gastos_comunidad,
         NEW.obra_nueva, NEW.tipo_detallado, NEW.anunciante, NEW.agencia_nombre))
  EXECUTE FUNCTION public.mercado_registrar_cambios();


-- ------------------------------------------------------------
-- 3b. Que lo viejo no pise a lo nuevo, y que un hueco no borre un dato
--
-- DOS PROBLEMAS QUE SALIERON AL PROBAR VAL 02 CON EL RESCATE DEL CAPTADOR:
--
--   · CAPTURAS VIEJAS. VAL 02 contesta al captador en cuanto recibe el lote y
--     puede tener dos ejecuciones a la vez; el backfill, además, manda capturas
--     del 08/09 al 17/09. Sin esto, una captura del día 9 que llegue después de
--     una del 15 dejaba el precio y la fecha del día 9, apuntaba "cambios" hacia
--     atrás y podía bajar fecha_ultima_vista por debajo del último escaneo, y el
--     escaneo siguiente contaría una falta que no es.
--     Regla: si la fila que llega trae una fecha_ultima_vista ANTERIOR a la
--     guardada, esa fila no se toca (RETURN NULL). Nadie baja esa fecha a
--     propósito: la función de escaneo usa greatest() y el "Update Precio" de
--     VAL 01 no la manda.
--
--   · FORMATO CORTO. Idealista da cada anuncio en dos formatos, y el corto no trae
--     terraza, aire acondicionado, parking ni otros. De 1.684 capturas en
--     València, 891 eran cortas. Una captura corta después de una larga ponía
--     esos campos a null. El historial no lo apuntaba (no apunta pasos a null),
--     pero el dato se perdía hasta la siguiente captura larga.
--     Regla: en estas columnas, si llega null se queda el valor que había. Lo que
--     llega con valor, se escribe. `caracteristicas` se mezcla: las claves que
--     llegan pisan, las que no llegan se quedan.
--     No entran precio, metros, activo, las fechas, faltas_escaneo ni
--     ultimo_escaneo, que nunca llegan vacías o tienen su propia regla, ni
--     agencia_nombre, que es null de verdad cuando anuncia un particular.
--
-- BEFORE Y CON ESTE NOMBRE. Tiene que ir antes de `trg_mercado_baja` (también
-- BEFORE): Postgres ejecuta los BEFORE por orden alfabético del nombre, y
-- 'trg_mercado_a_...' va delante de 'trg_mercado_baja'. Si esta fila se ignora,
-- los demás triggers ni se enteran. Y va antes que el AFTER del punto 3, que así
-- ve la fila ya completada y no confunde un hueco con un cambio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mercado_no_pisar_lo_que_se_sabe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.fecha_ultima_vista IS NOT NULL
     AND OLD.fecha_ultima_vista IS NOT NULL
     AND NEW.fecha_ultima_vista < OLD.fecha_ultima_vista THEN
    RETURN NULL;
  END IF;

  NEW.codbarrio           := coalesce(NEW.codbarrio,           OLD.codbarrio);
  NEW.barrio              := coalesce(NEW.barrio,              OLD.barrio);
  NEW.lat                 := coalesce(NEW.lat,                 OLD.lat);
  NEW.lng                 := coalesce(NEW.lng,                 OLD.lng);
  NEW.habitaciones        := coalesce(NEW.habitaciones,        OLD.habitaciones);
  NEW.banos               := coalesce(NEW.banos,               OLD.banos);
  NEW.planta              := coalesce(NEW.planta,              OLD.planta);
  NEW.ascensor            := coalesce(NEW.ascensor,            OLD.ascensor);
  NEW.estado_conservacion := coalesce(NEW.estado_conservacion, OLD.estado_conservacion);
  NEW.imagen_url          := coalesce(NEW.imagen_url,          OLD.imagen_url);
  NEW.usable_area         := coalesce(NEW.usable_area,         OLD.usable_area);
  NEW.exterior            := coalesce(NEW.exterior,            OLD.exterior);
  NEW.energia             := coalesce(NEW.energia,             OLD.energia);
  NEW.energia_kwh         := coalesce(NEW.energia_kwh,         OLD.energia_kwh);
  NEW.piscina             := coalesce(NEW.piscina,             OLD.piscina);
  NEW.jardin              := coalesce(NEW.jardin,              OLD.jardin);
  NEW.trastero            := coalesce(NEW.trastero,            OLD.trastero);
  NEW.parking             := coalesce(NEW.parking,             OLD.parking);
  NEW.terraza             := coalesce(NEW.terraza,             OLD.terraza);
  NEW.aire                := coalesce(NEW.aire,                OLD.aire);
  NEW.gastos_comunidad    := coalesce(NEW.gastos_comunidad,    OLD.gastos_comunidad);
  NEW.obra_nueva          := coalesce(NEW.obra_nueva,          OLD.obra_nueva);
  NEW.tipo_detallado      := coalesce(NEW.tipo_detallado,      OLD.tipo_detallado);
  NEW.descripcion         := coalesce(NEW.descripcion,         OLD.descripcion);
  NEW.num_fotos           := coalesce(NEW.num_fotos,           OLD.num_fotos);

  IF OLD.caracteristicas IS NOT NULL AND NEW.caracteristicas IS NOT NULL THEN
    NEW.caracteristicas := OLD.caracteristicas || jsonb_strip_nulls(NEW.caracteristicas);
  ELSE
    NEW.caracteristicas := coalesce(NEW.caracteristicas, OLD.caracteristicas);
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.mercado_no_pisar_lo_que_se_sabe() IS
  'Antes de actualizar un anuncio: ignora capturas más viejas que la guardada y no deja que un campo vacío borre un dato conocido. Migración 038.';

DROP TRIGGER IF EXISTS trg_mercado_a_no_pisar ON public.mercado_inmuebles;
CREATE TRIGGER trg_mercado_a_no_pisar
  BEFORE UPDATE ON public.mercado_inmuebles
  FOR EACH ROW
  EXECUTE FUNCTION public.mercado_no_pisar_lo_que_se_sabe();


-- ------------------------------------------------------------
-- 4. mercado_aplicar_escaneo(): la única regla de publicado o baja
--
-- PARA QUÉ. Cada domingo VAL 01 recorrerá entero
-- https://www.idealista.com/venta-viviendas/valencia-valencia/ y llamará a esta
-- función con TODOS los ids que ha visto, cuándo empezó y cuántos anuncios decía
-- Idealista que había. Nada más marca bajas.
--
-- LA REGLA.
--   · Visto: publicado, cero faltas, y fecha_ultima_vista como mínimo la del
--     inicio del escaneo.
--   · No visto, siendo venta de vivienda, activo, y conocido desde antes de que
--     empezara el escaneo: una falta más. A la SEGUNDA falta seguida, baja.
--     Una sola falta no basta: un anuncio puede no salir en una pasada por
--     cómo pagina Idealista.
--   · Si alguien lo vio DESPUÉS del último escaneo que lo contó (VAL 02 le ha
--     subido la fecha_ultima_vista), la cuenta vuelve a empezar: esta falta es la
--     primera. Lo mismo si está activo con dos faltas o más, que sólo puede ser
--     porque algo que no es el escaneo lo reactivó.
--   · Tampoco cuenta como falta un anuncio visto por otra vía desde que empezó
--     el escaneo, ni uno que entró en la tabla mientras tanto.
--
-- LAS GUARDAS. Si alguna falla, se para con un error y no se toca NADA:
--   · Menos del 97% de lo que dice Idealista: el escaneo se cortó y todo lo que
--     no llegó a ver parecería de baja. Los ids se cuentan sin repetir.
--   · Un total por debajo de 3.000: eso no es la venta de viviendas de València.
--   · Un inicio en el futuro o de hace más de dos días.
--   · Un escaneo igual de nuevo o más nuevo ya aplicado: un reintento de n8n
--     contaría dos veces las mismas faltas. Si hiciera falta repetir uno a
--     propósito, poner `ultimo_escaneo` a null en las filas de ese escaneo.
--
-- EL CANDADO. Antes de tocar nada, la función bloquea la tabla para escritura
-- (SHARE ROW EXCLUSIVE) hasta que termina. Las lecturas del CRM siguen igual;
-- lo que espera unos segundos es cualquier otra escritura. Hace dos cosas:
--   · dos llamadas a la vez no se pisan: la segunda espera, y cuando entra ve
--     el escaneo ya aplicado y se niega;
--   · no hay interbloqueos con un lote de VAL 02 que llegue a la vez. Sin el
--     candado, la función y el upsert bloquean las mismas filas en distinto
--     orden, y Postgres mata a uno de los dos: si le toca al lote de VAL 02,
--     esas capturas no llegan a la tabla.
--
-- OJO CON EL MODO MONITOR. Con monitoringMode el actor sólo DEVUELVE los
-- anuncios nuevos para esa cuenta de Apify. `p_vistos` tiene que llevar todos
-- los ids que el escaneo recorrió, no sólo los nuevos. Si llegan sólo los nuevos,
-- la guarda del 97% lo para, que es justo para lo que está.
--
-- LAS 701 BAJAS VIEJAS. Las que el escaneo vea se reactivan solas, y el trigger
-- apunta 'publicado' de no a sí. Es de esperar un montón el primer domingo, y no
-- son anuncios republicados: son bajas mal puestas que se corrigen. Se reconocen
-- porque no tienen antes un 'publicado' de sí a no (esas bajas son anteriores al
-- trigger). Ojo: al reactivar, `trg_mercado_baja` borra su fecha_baja y su
-- precio_baja, como ha hecho siempre.
--
-- ALCANCE. Todo lo que hay en la tabla es venta de vivienda en València (VAL 01
-- ya scrapeaba esa URL y VAL 02 filtra igual). Si un día entra alquiler u otra
-- ciudad, hay que filtrarlo aquí, o este escaneo los daría de baja.
--
-- Devuelve cuántos: vistos, total, confirmados (vistos que ya estaban activos),
-- reactivados, primera_falta, bajas y vistos_sin_fila (vistos que no están en la
-- tabla: si son muchos, VAL 02 no está guardando).
--
-- PERMISOS. Función normal (SECURITY INVOKER): hace lo que pueda hacer quien la
-- llama. Sólo la puede llamar `service_role`, que es n8n. Quitarle el permiso a
-- anon y authenticated no es un detalle: sin la 036 no hay RLS en estas tablas,
-- y cualquiera con la clave pública podría dar de baja el mercado entero.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mercado_aplicar_escaneo(
  p_vistos text[],
  p_inicio timestamptz,
  p_total  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_ids           text[];
  v_vistos        integer;
  v_ultimo        timestamptz;
  v_confirmados   bigint := 0;
  v_reactivados   bigint := 0;
  v_primera_falta bigint := 0;
  v_bajas         bigint := 0;
BEGIN
  SELECT array_agg(DISTINCT btrim(x))
    INTO v_ids
    FROM unnest(p_vistos) AS x
   WHERE NULLIF(btrim(x), '') IS NOT NULL;
  v_ids    := coalesce(v_ids, '{}');
  v_vistos := cardinality(v_ids);

  -- Guardas
  IF p_inicio IS NULL OR p_total IS NULL THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: faltan p_inicio o p_total. No se ha tocado nada.';
  END IF;

  IF p_total < 3000 THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: un total de % anuncios no es la venta de viviendas de València (mínimo 3000). No se ha tocado nada.', p_total;
  END IF;

  IF v_vistos < 0.97 * p_total THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: escaneo incompleto, % ids distintos vistos de % (hace falta el 97%%). No se ha tocado nada.', v_vistos, p_total;
  END IF;

  IF p_inicio > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: el inicio (%) está en el futuro. No se ha tocado nada.', p_inicio;
  END IF;

  IF p_inicio < now() - interval '2 days' THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: el escaneo empezó el % y hace más de dos días; ya no dice nada de lo que está publicado hoy. No se ha tocado nada.', p_inicio;
  END IF;

  -- Ver "EL CANDADO". Se suelta solo al acabar la transacción.
  LOCK TABLE public.mercado_inmuebles IN SHARE ROW EXCLUSIVE MODE;

  SELECT max(ultimo_escaneo) INTO v_ultimo FROM public.mercado_inmuebles;
  IF v_ultimo >= p_inicio THEN
    RAISE EXCEPTION 'mercado_aplicar_escaneo: ya se aplicó un escaneo que empezó el % y éste empezó el %. Un escaneo no se cuenta dos veces. No se ha tocado nada.', v_ultimo, p_inicio;
  END IF;

  -- Vistos
  WITH antes AS (
    SELECT m.id, m.activo
      FROM public.mercado_inmuebles m
      JOIN unnest(v_ids) AS v(idealista_id) USING (idealista_id)
  ), hecho AS (
    UPDATE public.mercado_inmuebles m
       SET activo             = true,
           faltas_escaneo     = 0,
           fecha_ultima_vista = greatest(m.fecha_ultima_vista, p_inicio),
           ultimo_escaneo     = p_inicio
      FROM antes a
     WHERE m.id = a.id
    RETURNING a.activo AS activo_antes
  )
  SELECT count(*) FILTER (WHERE activo_antes IS NOT false),
         count(*) FILTER (WHERE activo_antes IS false)
    INTO v_confirmados, v_reactivados
    FROM hecho;

  -- No vistos
  WITH candidatas AS (
    SELECT m.id,
           CASE
             WHEN m.ultimo_escaneo IS NULL
               OR m.faltas_escaneo >= 2
               OR m.fecha_ultima_vista > m.ultimo_escaneo
             THEN 1
             ELSE m.faltas_escaneo + 1
           END AS faltas
      FROM public.mercado_inmuebles m
     WHERE m.operacion = 'venta'
       AND m.tipo = 'homes'
       AND m.activo IS TRUE
       AND m.fecha_primera_vista < p_inicio
       AND (m.fecha_ultima_vista IS NULL OR m.fecha_ultima_vista < p_inicio)
       AND NOT EXISTS (SELECT 1 FROM unnest(v_ids) AS v(id) WHERE v.id = m.idealista_id)
  ), hecho AS (
    UPDATE public.mercado_inmuebles m
       SET faltas_escaneo = c.faltas,
           activo         = (c.faltas < 2),
           ultimo_escaneo = p_inicio
      FROM candidatas c
     WHERE m.id = c.id
    RETURNING c.faltas
  )
  SELECT count(*) FILTER (WHERE faltas < 2),
         count(*) FILTER (WHERE faltas >= 2)
    INTO v_primera_falta, v_bajas
    FROM hecho;

  RETURN jsonb_build_object(
    'vistos',          v_vistos,
    'total',           p_total,
    'confirmados',     v_confirmados,
    'reactivados',     v_reactivados,
    'primera_falta',   v_primera_falta,
    'bajas',           v_bajas,
    'vistos_sin_fila', v_vistos - v_confirmados - v_reactivados
  );
END;
$fn$;

COMMENT ON FUNCTION public.mercado_aplicar_escaneo(text[], timestamptz, integer) IS
  'Única regla de publicado o baja del mercado: aplica un escaneo completo de venta de viviendas en València. Dos faltas seguidas, baja. Se niega si el escaneo no llega al 97 por ciento o ya se aplicó. Sólo service_role. Migración 038.';

REVOKE ALL ON FUNCTION public.mercado_aplicar_escaneo(text[], timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mercado_aplicar_escaneo(text[], timestamptz, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mercado_aplicar_escaneo(text[], timestamptz, integer) TO service_role;

-- Que PostgREST vea ya las columnas y la función nuevas, sin esperar.
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 5. Comprobación
--
-- Una sola consulta, porque el SQL Editor sólo enseña el último resultado. La
-- columna `ok` tiene que salir true en todas las filas que tienen `esperado`.
-- Las que no lo tienen son para leer.
-- ------------------------------------------------------------
SELECT n, comprobacion, valor, esperado,
       CASE WHEN esperado IS NULL THEN NULL ELSE valor = esperado END AS ok
  FROM (
    SELECT 1 AS n,
           'columnas nuevas en mercado_inmuebles' AS comprobacion,
           (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'mercado_inmuebles'
               AND column_name IN ('descripcion', 'num_fotos', 'faltas_escaneo', 'ultimo_escaneo'))::text AS valor,
           '4' AS esperado
    UNION ALL
    SELECT 2, 'columnas nuevas en mercado_precio_historial',
           (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'mercado_precio_historial'
               AND column_name IN ('campo', 'valor_anterior', 'valor_nuevo'))::text,
           '3'
    UNION ALL
    SELECT 3, 'filas del historial sin campo',
           (SELECT count(*) FROM public.mercado_precio_historial WHERE campo IS NULL)::text,
           '0'
    UNION ALL
    SELECT 4, 'historial por campo (recién ejecutada: precio=228)',
           (SELECT string_agg(campo || '=' || filas, ', ' ORDER BY campo)
              FROM (SELECT campo, count(*) AS filas
                      FROM public.mercado_precio_historial GROUP BY campo) s),
           NULL
    UNION ALL
    SELECT 5, 'trigger nuevo trg_mercado_registrar_cambios',
           (SELECT count(*) FROM pg_trigger
             WHERE tgrelid = 'public.mercado_inmuebles'::regclass
               AND tgname = 'trg_mercado_registrar_cambios' AND NOT tgisinternal)::text,
           '1'
    UNION ALL
    SELECT 6, 'trigger de siempre trg_mercado_baja, sigue ahí',
           (SELECT count(*) FROM pg_trigger
             WHERE tgrelid = 'public.mercado_inmuebles'::regclass
               AND tgname = 'trg_mercado_baja' AND NOT tgisinternal)::text,
           '1'
    UNION ALL
    SELECT 7, 'campos vigilados por el trigger que no existen en la tabla',
           (SELECT count(*)
              FROM unnest(ARRAY[
                'precio', 'activo', 'descripcion', 'fecha_ultima_vista',
                'num_fotos', 'metros', 'usable_area', 'habitaciones', 'banos', 'planta',
                'ascensor', 'estado_conservacion', 'exterior', 'energia', 'piscina',
                'jardin', 'trastero', 'parking', 'terraza', 'aire', 'gastos_comunidad',
                'obra_nueva', 'tipo_detallado', 'anunciante', 'agencia_nombre'
              ]) AS c(nombre)
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'public'
                                  AND table_name = 'mercado_inmuebles'
                                  AND column_name = c.nombre))::text,
           '0'
    UNION ALL
    SELECT 8, 'anon puede llamar a mercado_aplicar_escaneo',
           has_function_privilege('anon', 'public.mercado_aplicar_escaneo(text[], timestamptz, integer)', 'EXECUTE')::text,
           'false'
    UNION ALL
    SELECT 9, 'authenticated puede llamarla',
           has_function_privilege('authenticated', 'public.mercado_aplicar_escaneo(text[], timestamptz, integer)', 'EXECUTE')::text,
           'false'
    UNION ALL
    SELECT 10, 'service_role (n8n) puede llamarla',
           has_function_privilege('service_role', 'public.mercado_aplicar_escaneo(text[], timestamptz, integer)', 'EXECUTE')::text,
           'true'
    UNION ALL
    SELECT 11, 'índice (idealista_id, fecha desc)',
           (SELECT count(*) FROM pg_indexes
             WHERE schemaname = 'public' AND indexname = 'idx_precio_hist_id_fecha')::text,
           '1'
    UNION ALL
    SELECT 12, 'cambios de precio apuntados dos veces en menos de un día (VAL 01 con Insert Historial)',
           (SELECT count(*)
              FROM public.mercado_precio_historial a
              JOIN public.mercado_precio_historial b
                ON b.idealista_id = a.idealista_id
               AND b.id > a.id
               AND a.campo = 'precio' AND b.campo = 'precio'
               AND b.precio_anterior = a.precio_anterior
               AND b.precio_nuevo = a.precio_nuevo
               AND abs(extract(epoch FROM b.fecha - a.fecha)) < 86400)::text,
           '0'
    UNION ALL
    SELECT 13, 'RLS activado (true en las dos si ya se ejecutó la 036; esta migración funciona igual)',
           (SELECT string_agg(relname::text || '=' || relrowsecurity::text, ', ' ORDER BY relname)
              FROM pg_class
             WHERE oid IN ('public.mercado_inmuebles'::regclass,
                           'public.mercado_precio_historial'::regclass)),
           NULL
    UNION ALL
    -- Lee la lista del FOREACH de la función tal como está guardada y busca cada
    -- campo en el WHEN del trigger (pg_get_triggerdef lo escribe como old.campo).
    -- Un campo que la función vigila y el WHEN no mira sólo se apuntaría cuando
    -- cambiara a la vez que otro.
    SELECT 14, 'campos que la función vigila y el WHEN del trigger no mira',
           (SELECT CASE WHEN count(*) > 3
                        THEN (count(*) FILTER (WHERE d.def !~* ('old\.' || c.nombre || '\M')))::text
                        ELSE 'no se encuentra la lista del FOREACH en la función'
                   END
              FROM (SELECT coalesce((SELECT pg_get_triggerdef(t.oid)
                                       FROM pg_trigger t
                                      WHERE t.tgrelid = 'public.mercado_inmuebles'::regclass
                                        AND t.tgname = 'trg_mercado_registrar_cambios'), '') AS def) d
             CROSS JOIN unnest(
                   ARRAY['precio', 'activo', 'descripcion']
                   || ARRAY(SELECT r.m[1]
                              FROM regexp_matches(
                                     substring(pg_get_functiondef('public.mercado_registrar_cambios()'::regprocedure)
                                               FROM 'FOREACH v_campo IN ARRAY ARRAY\[([^]]*)\]'),
                                     '''([a-z_]+)''', 'g') AS r(m))
                 ) AS c(nombre)),
           '0'
    UNION ALL
    SELECT 15, 'trigger trg_mercado_a_no_pisar (capturas viejas y huecos)',
           (SELECT count(*) FROM pg_trigger
             WHERE tgrelid = 'public.mercado_inmuebles'::regclass
               AND tgname = 'trg_mercado_a_no_pisar' AND NOT tgisinternal)::text,
           '1'
    UNION ALL
    -- Los BEFORE van por orden alfabético: éste tiene que ir el primero.
    SELECT 16, 'primer trigger BEFORE UPDATE de mercado_inmuebles',
           (SELECT tgname::text FROM pg_trigger
             WHERE tgrelid = 'public.mercado_inmuebles'::regclass
               AND NOT tgisinternal
               AND (tgtype & 2) = 2      -- BEFORE
               AND (tgtype & 16) = 16    -- UPDATE
             ORDER BY tgname LIMIT 1),
           'trg_mercado_a_no_pisar'
  ) t
 ORDER BY n;

-- Las pruebas de esta migración están en supabase/pruebas/038_pruebas_mercado.sql.
-- Se ejecutan de una en una, nunca junto con esto.
