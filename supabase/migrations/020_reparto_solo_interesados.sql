-- ============================================================
-- MIGRACIÓN 020: repartir sólo lo que tiene interés
--
-- POR QUÉ.
-- En la 017 puse el reparto en un `BEFORE INSERT`: la captación se asignaba en
-- el momento del scrapeo. Eso está mal y no es un detalle.
--
-- Una captación recién scrapeada es un anuncio de Idealista al que todavía no
-- se le ha escrito. Repartirla ahí reparte trabajo que no existe: el agente ve
-- 40 propiedades suyas de las que 38 nunca contestarán, y el turno de todos se
-- desordena repartiendo humo. El propietario entra en juego cuando responde y
-- dice que le interesa; antes, el que trabaja es el bot.
--
-- Lo que hay hoy, medido el 14/09/2026:
--
--   captaciones ................. 1.031
--   con interés ...................  93   (66 Interesado + 27 Quiere_Llamada)
--     ya tienen agente ............  37
--     esperando sin agente ........  56   <- éstas se repartirán al activarlo
--   con agente pero SIN interés ...  48   <- repartidas de más, se quedan como están
--
-- QUÉ CAMBIA.
-- El disparo pasa de "cuando entra" a "cuando muestra interés": el trigger
-- salta al pasar `estado_whatsapp` a 'Interesado' o 'Quiere_Llamada', que son
-- los dos estados que el CRM ya cuenta como interés en la tarjeta del scraper.
--
-- Las 48 repartidas de más NO se tocan. Quitarle a un agente algo que ya tiene
-- asignado es peor que dejarlo: puede haber llamado ya.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El reparto, ahora disparado por el interés
--
-- Se conservan todas las guardas de la 017 (ya tiene agente, traspaso, sin
-- teléfono, modo manual) porque siguen siendo válidas. Lo único que cambia es
-- CUÁNDO se llama a esto.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_captacion_interesada()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_modo   text;
  v_agente uuid;
  v_motivo text;
  v_cursor integer;
BEGIN
  -- Si ya viene con agente, se respeta.
  IF NEW.agente_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Un traspaso o una captación sin teléfono no se reparten: nadie va a llamar.
  IF NEW.activo IS FALSE OR NEW.telefono IS NULL OR NEW.telefono = '' THEN
    RETURN NEW;
  END IF;

  SELECT value #>> '{}' INTO v_modo FROM public.app_settings WHERE key = 'asignacion_modo';
  IF COALESCE(v_modo, 'manual') <> 'automatico' THEN
    NEW.asignacion_motivo := 'Reparto manual: interesado esperando asignación';
    RETURN NEW;
  END IF;

  SELECT s.agente_id, s.motivo, s.cursor_nuevo
    INTO v_agente, v_motivo, v_cursor
    FROM public.siguiente_agente(NEW.telefono, COALESCE(NEW.rechazado_por, '{}')) s;

  NEW.asignacion_motivo := v_motivo;

  IF v_agente IS NOT NULL THEN
    NEW.agente_id   := v_agente;
    NEW.asignado_en := now();
    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';
  END IF;

  RETURN NEW;
END;
$fn$;


-- ------------------------------------------------------------
-- 2. Cambiar el disparo
--
-- Fuera el de INSERT, que era el error. Y dos triggers en su lugar:
--
--   · el normal: cuando `estado_whatsapp` PASA a interesado. La condición de
--     cambio real (OLD IS DISTINCT FROM NEW) evita que un UPDATE que toque otra
--     cosa vuelva a disparar el reparto de algo ya repartido.
--
--   · el raro pero posible: que entre ya marcada como interesada, por ejemplo
--     al importar a mano o si algún día el bot crea la fila después de hablar.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS captaciones_reparto_automatico ON public.captaciones;

DROP TRIGGER IF EXISTS captaciones_reparto_interes ON public.captaciones;
CREATE TRIGGER captaciones_reparto_interes
  BEFORE UPDATE OF estado_whatsapp ON public.captaciones
  FOR EACH ROW
  WHEN (NEW.estado_whatsapp IN ('Interesado', 'Quiere_Llamada')
        AND OLD.estado_whatsapp IS DISTINCT FROM NEW.estado_whatsapp)
  EXECUTE FUNCTION public.repartir_captacion_interesada();

DROP TRIGGER IF EXISTS captaciones_reparto_interes_alta ON public.captaciones;
CREATE TRIGGER captaciones_reparto_interes_alta
  BEFORE INSERT ON public.captaciones
  FOR EACH ROW
  WHEN (NEW.estado_whatsapp IN ('Interesado', 'Quiere_Llamada'))
  EXECUTE FUNCTION public.repartir_captacion_interesada();

-- La función vieja ya no la usa ningún trigger. Se deja un rato por si hay que
-- volver atrás; se puede tirar cuando esto lleve unos días funcionando:
--   DROP FUNCTION IF EXISTS public.repartir_captacion_nueva();


-- ------------------------------------------------------------
-- 3. Repartir de golpe lo que ya está esperando
--
-- Las 56 que ya mostraron interés y se quedaron sin agente porque el trigger
-- viejo las repartió cuando no tocaba (o no las repartió). Se llama desde el
-- botón "Repartir" de la pantalla del scraper.
--
-- Devuelve cuántas ha repartido, para poder decírselo a quien pulsa el botón en
-- vez de dejarlo adivinando.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repartir_interesadas_pendientes(p_tope integer DEFAULT 50)
RETURNS TABLE (repartidas integer, sin_agente integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r          record;
  v_agente   uuid;
  v_motivo   text;
  v_cursor   integer;
  v_hechas   integer := 0;
  v_fallidas integer := 0;
BEGIN
  FOR r IN
    SELECT id, telefono, rechazado_por
    FROM public.captaciones
    WHERE agente_id IS NULL
      AND estado_whatsapp IN ('Interesado', 'Quiere_Llamada')
      AND activo IS NOT FALSE
      AND telefono IS NOT NULL
      AND telefono <> ''
    -- El que lleva más tiempo esperando, primero.
    ORDER BY ultimo_contacto_en ASC NULLS LAST, id ASC
    LIMIT GREATEST(p_tope, 0)
  LOOP
    SELECT s.agente_id, s.motivo, s.cursor_nuevo
      INTO v_agente, v_motivo, v_cursor
      FROM public.siguiente_agente(r.telefono, COALESCE(r.rechazado_por, '{}')) s;

    IF v_agente IS NULL THEN
      -- Sin agente disponible: se anota el motivo y se sigue. Parar aquí
      -- dejaría sin repartir a las siguientes por culpa de una.
      UPDATE public.captaciones SET asignacion_motivo = v_motivo WHERE id = r.id;
      v_fallidas := v_fallidas + 1;
      CONTINUE;
    END IF;

    UPDATE public.captaciones
       SET agente_id = v_agente, asignado_en = now(), asignacion_motivo = v_motivo
     WHERE id = r.id;

    UPDATE public.app_settings
       SET value = to_jsonb(v_cursor), updated_at = now()
     WHERE key = 'asignacion_cursor';

    v_hechas := v_hechas + 1;
  END LOOP;

  RETURN QUERY SELECT v_hechas, v_fallidas;
END;
$fn$;

COMMENT ON FUNCTION public.repartir_interesadas_pendientes(integer) IS
  'Reparte las captaciones con interés que se quedaron sin agente. Devuelve (repartidas, sin_agente).';


-- ------------------------------------------------------------
-- 4. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Debe salir SOLO captaciones_reparto_interes y ..._alta:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.captaciones'::regclass AND NOT tgisinternal
--    ORDER BY tgname;
--
--   -- Cuántas esperan reparto ahora mismo (deberían ser 56):
--   SELECT count(*) FROM public.captaciones
--    WHERE agente_id IS NULL
--      AND estado_whatsapp IN ('Interesado', 'Quiere_Llamada')
--      AND activo IS NOT FALSE AND telefono <> '';
--
--   -- Repartirlas (sólo hace algo si el modo está en automático para el trigger;
--   -- esta función reparte igualmente, es la del botón):
--   --   SELECT * FROM public.repartir_interesadas_pendientes(50);
