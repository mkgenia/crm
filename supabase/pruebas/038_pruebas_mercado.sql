-- ============================================================
-- PRUEBAS DE LA MIGRACIÓN 038. NO EJECUTAR EL ARCHIVO ENTERO.
--
-- Estaban al final de la migración dentro de un comentario /* ... */, y el SQL
-- Editor de Supabase las ejecutó igual el 17/09/2026 (error "relation v_id does
-- not exist": la migración entera se deshizo). Por eso viven aquí aparte.
--
-- Cada prueba es un bloque DO que hace los cambios y termina A PROPÓSITO en un
-- ERROR con el resultado dentro. El error deshace TODO lo que ha hecho (sale en
-- rojo y es lo esperado) y el mensaje dice qué ha pasado.
--
-- Para ejecutar una: copiar desde DO hasta $prueba$; y pegarla SOLA en el SQL
-- Editor, con la migración 038 ya ejecutada.
-- ============================================================


-- PRUEBA 1. El trigger. Tiene que decir: 3 filas nuevas y fecha_baja true.
DO $prueba$
DECLARE
  v_id    text;
  v_desde bigint;
  v_filas bigint;
  v_baja  boolean;
  v_log   text;
BEGIN
  SELECT idealista_id INTO v_id
    FROM public.mercado_inmuebles
   WHERE activo AND precio > 10000
   ORDER BY id LIMIT 1;
  SELECT coalesce(max(id), 0) INTO v_desde FROM public.mercado_precio_historial;

  -- a) Bajada de 5.000 euros                               -> 1 fila 'precio'
  UPDATE public.mercado_inmuebles SET precio = precio - 5000 WHERE idealista_id = v_id;

  -- b) El upsert de n8n reescribiendo lo mismo             -> nada
  INSERT INTO public.mercado_inmuebles (idealista_id, precio, metros, planta, activo)
  SELECT idealista_id, precio, metros, planta, activo
    FROM public.mercado_inmuebles WHERE idealista_id = v_id
  ON CONFLICT (idealista_id) DO UPDATE
     SET precio = EXCLUDED.precio, metros = EXCLUDED.metros,
         planta = EXCLUDED.planta, activo = EXCLUDED.activo;

  -- c) Pasos por null en planta y descripción              -> nada
  UPDATE public.mercado_inmuebles SET planta = NULL, descripcion = NULL WHERE idealista_id = v_id;
  UPDATE public.mercado_inmuebles SET planta = '3', descripcion = 'Piso luminoso.' WHERE idealista_id = v_id;

  -- d) El mismo texto con espacios y un salto de línea     -> nada
  UPDATE public.mercado_inmuebles
     SET descripcion = '  Piso   luminoso.  ' || chr(10)
   WHERE idealista_id = v_id;

  -- e) Un texto distinto de verdad                         -> 1 fila 'descripcion'
  UPDATE public.mercado_inmuebles SET descripcion = 'Piso luminoso y reformado.' WHERE idealista_id = v_id;

  -- f) Deja de estar publicado                             -> 1 fila 'publicado'
  UPDATE public.mercado_inmuebles SET activo = false WHERE idealista_id = v_id;

  SELECT count(*),
         string_agg(format('%s: %s -> %s (delta %s, pct %s, %s)',
                           campo, valor_anterior, valor_nuevo, delta, pct, direccion),
                    ' | ' ORDER BY id)
    INTO v_filas, v_log
    FROM public.mercado_precio_historial
   WHERE id > v_desde AND idealista_id = v_id;
  SELECT fecha_baja IS NOT NULL INTO v_baja
    FROM public.mercado_inmuebles WHERE idealista_id = v_id;

  RAISE EXCEPTION 'PRUEBA 1, no se ha guardado nada. Filas nuevas en el historial: % (tienen que ser 3). fecha_baja rellena: % (tiene que ser true). Detalle: %',
    v_filas, v_baja, v_log;
END
$prueba$;


-- PRUEBA 2. El escaneo. Sólo vale antes del primer escaneo de verdad.
-- Tiene que decir: rechaza el corto, no repite, 1er escaneo primera_falta 3 y
-- bajas 0, 2º escaneo primera_falta 1 y bajas 2 (el primero de los tres lo "ve"
-- VAL 02 entre los dos escaneos, así que su cuenta vuelve a empezar), y el piso
-- que entra durante el 2º escaneo queda sin tocar: faltas 0, activo true,
-- ultimo_escaneo vacío. Los reactivados del 1º son las bajas viejas, que el
-- escaneo de prueba "ve" todas.
DO $prueba$
DECLARE
  v_fuera   text[];
  v_vistos  text[];
  v_r1      jsonb;
  v_r2      jsonb;
  v_guardas text := '';
  v_nuevo   text;
BEGIN
  -- Tres pisos activos y antiguos que este escaneo no va a ver
  SELECT array_agg(idealista_id) INTO v_fuera
    FROM (SELECT idealista_id FROM public.mercado_inmuebles
           WHERE activo AND operacion = 'venta' AND tipo = 'homes'
             AND fecha_primera_vista < now() - interval '1 day'
             AND fecha_ultima_vista  < now() - interval '1 day'
           ORDER BY id LIMIT 3) s;

  -- Todos los demás sí, más ids inventados para pasar del 97 por ciento de 3.000
  SELECT array_agg(idealista_id) INTO v_vistos
    FROM public.mercado_inmuebles WHERE idealista_id <> ALL (v_fuera);
  v_vistos := v_vistos || ARRAY(SELECT 'prueba-' || g FROM generate_series(1, 3000) AS g);

  BEGIN
    PERFORM public.mercado_aplicar_escaneo(v_vistos[1:100], now() - interval '1 hour', 3000);
    v_guardas := v_guardas || 'MAL: acepta un escaneo corto. ';
  EXCEPTION WHEN raise_exception THEN
    v_guardas := v_guardas || 'bien: rechaza el escaneo corto. ';
  END;

  v_r1 := public.mercado_aplicar_escaneo(v_vistos, now() - interval '1 hour', 3000);

  BEGIN
    PERFORM public.mercado_aplicar_escaneo(v_vistos, now() - interval '1 hour', 3000);
    v_guardas := v_guardas || 'MAL: cuenta dos veces el mismo escaneo. ';
  EXCEPTION WHEN raise_exception THEN
    v_guardas := v_guardas || 'bien: no repite escaneo. ';
  END;

  -- Entre los dos escaneos, VAL 02 ve el primero de los tres (hace 45 minutos)
  UPDATE public.mercado_inmuebles
     SET fecha_ultima_vista = now() - interval '45 minutes'
   WHERE idealista_id = v_fuera[1];

  -- Y entra un piso nuevo (fecha_primera_vista = ahora, después del inicio del 2º)
  INSERT INTO public.mercado_inmuebles (idealista_id, operacion, tipo, precio, metros)
  VALUES ('prueba-nuevo', 'venta', 'homes', 100000, 50);

  v_r2 := public.mercado_aplicar_escaneo(v_vistos, now() - interval '30 minutes', 3000);

  SELECT format('faltas %s, activo %s, ultimo_escaneo %s',
                faltas_escaneo, activo, coalesce(ultimo_escaneo::text, 'vacío'))
    INTO v_nuevo
    FROM public.mercado_inmuebles WHERE idealista_id = 'prueba-nuevo';

  RAISE EXCEPTION 'PRUEBA 2, no se ha guardado nada. % | 1er escaneo: % | 2do escaneo: % | piso nuevo: %',
    v_guardas, v_r1, v_r2, v_nuevo;
END
$prueba$;


-- PRUEBA 3. Lo viejo no pisa y los huecos no borran. Tiene que decir:
-- precio sin tocar true, terraza conservada true, historial 0.
DO $prueba$
DECLARE
  v_id      text;
  v_precio  numeric;
  v_desde   bigint;
  v_ok_prec boolean;
  v_ok_terr boolean;
  v_filas   bigint;
BEGIN
  SELECT idealista_id, precio INTO v_id, v_precio
    FROM public.mercado_inmuebles
   WHERE activo AND precio > 10000 AND fecha_ultima_vista IS NOT NULL
   ORDER BY id LIMIT 1;
  SELECT coalesce(max(id), 0) INTO v_desde FROM public.mercado_precio_historial;

  UPDATE public.mercado_inmuebles SET terraza = true WHERE idealista_id = v_id;
  SELECT coalesce(max(id), 0) INTO v_desde FROM public.mercado_precio_historial;

  -- a) Una captura de hace un año con otro precio        -> se ignora
  UPDATE public.mercado_inmuebles
     SET precio = precio + 12345,
         fecha_ultima_vista = fecha_ultima_vista - interval '365 days'
   WHERE idealista_id = v_id;

  -- b) Una captura corta, sin terraza                     -> terraza se queda
  UPDATE public.mercado_inmuebles SET terraza = NULL WHERE idealista_id = v_id;

  SELECT precio = v_precio, terraza IS TRUE INTO v_ok_prec, v_ok_terr
    FROM public.mercado_inmuebles WHERE idealista_id = v_id;
  SELECT count(*) INTO v_filas
    FROM public.mercado_precio_historial WHERE id > v_desde AND idealista_id = v_id;

  RAISE EXCEPTION 'PRUEBA 3, no se ha guardado nada. precio sin tocar: % | terraza conservada: % | historial: % (tiene que ser 0)',
    v_ok_prec, v_ok_terr, v_filas;
END
$prueba$;


-- Y para mirar, ya en marcha, lo último que ha cambiado que no sea precio:
SELECT idealista_id, campo, valor_anterior, valor_nuevo, fecha
  FROM public.mercado_precio_historial
 WHERE campo <> 'precio'
 ORDER BY fecha DESC, id DESC
 LIMIT 50;
