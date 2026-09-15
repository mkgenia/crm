-- ============================================================
-- MIGRACIÓN 027: un estado menos, una señal más
--
-- QUÉ CAMBIA.
-- `Interesado` y `Quiere_Llamada` dejan de ser estados y se funden en
-- `Respondido`. Lo que la IA entiende del mensaje pasa a una columna aparte,
-- `senal`, que no es un escalón del embudo: es una lectura automática.
--
--   estado_whatsapp  ->  ¿ha contestado?         Enviado · Respondido · No_Interesado…
--   senal            ->  ¿qué ha entendido la IA?  interesado · quiere_llamada · (nada)
--   estado_crm       ->  ¿por dónde va el trato?   Nuevo · Contactado · Interesado · Perdido
--
-- Una pregunta por columna. Hasta hoy `estado_whatsapp` respondía a las tres a
-- la vez y por eso había cinco columnas de estado describiendo lo mismo.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE.
-- Esos dos valores no eran etiquetas: eran el disparador de medio sistema. De
-- ellos dependen el reparto automático (020), el botón de repartir, el índice de
-- "sin atender" (021), la tarjeta de la portada, las pastillas de la lista y el
-- aviso al agente. Todo eso pasa a mirar `senal`.
--
-- Estado antes de ejecutar, sobre 757 captaciones activas:
--   Enviado 496 · Respondido 146 · Interesado 68 · Quiere_Llamada 27 · Sin_WhatsApp 8
--   Se funden 95. Respondido pasa de 146 a 241. De las 95, 38 ya tienen agente.
--
-- EL ORDEN DE ESTE FICHERO NO ES CASUAL: la señal se rellena ANTES de crear el
-- trigger nuevo. Al revés, el propio relleno dispararía el reparto de 95
-- captaciones de golpe.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El catálogo de la señal
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema) VALUES
  ('senal_interes', 'interesado',     'Le interesa',    'emerald', 10, true, true),
  ('senal_interes', 'quiere_llamada', 'Quiere llamada', 'amber',   20, true, true)
ON CONFLICT (tipo, valor) DO NOTHING;


-- ------------------------------------------------------------
-- 2. La columna
--
-- Se guarda también CUÁNDO se detectó: sirve para ordenar la lista del agente
-- por "el que lleva más tiempo esperando a que le llamen", que es lo que de
-- verdad quiere saber por la mañana.
-- ------------------------------------------------------------
ALTER TABLE public.captaciones
  ADD COLUMN IF NOT EXISTS senal    text,
  ADD COLUMN IF NOT EXISTS senal_en timestamptz;

COMMENT ON COLUMN public.captaciones.senal IS
  'Lo que la IA entiende del último mensaje del propietario: interesado | quiere_llamada. No es un estado del embudo, es una lectura automática. El estado va en estado_whatsapp y el embudo en estado_crm.';

DROP TRIGGER IF EXISTS captaciones_senal_cat ON public.captaciones;
CREATE TRIGGER captaciones_senal_cat
  BEFORE INSERT OR UPDATE OF senal ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_contra_catalogo('senal_interes', 'senal');


-- ------------------------------------------------------------
-- 3. Pasar lo que hay a la columna nueva
--
-- ANTES de tocar el trigger, a propósito (ver cabecera).
--
-- `senal_en` se saca del historial: es cuándo se clasificó de verdad, no cuándo
-- se ejecuta esta migración. Si no hay rastro en el historial, se cae a la
-- última vez que se le escribió.
-- ------------------------------------------------------------
UPDATE public.captaciones c
   SET senal = CASE c.estado_whatsapp
                 WHEN 'Interesado'     THEN 'interesado'
                 WHEN 'Quiere_Llamada' THEN 'quiere_llamada'
               END,
       senal_en = COALESCE(
         (SELECT max(h.fecha) FROM public.historial_cambios h
           WHERE h.captacion_id = c.id
             AND h.campo = 'estado_whatsapp'
             AND h.valor_nuevo IN ('Interesado', 'Quiere_Llamada')),
         c.ultimo_contacto_en,
         c.created_at)
 WHERE c.estado_whatsapp IN ('Interesado', 'Quiere_Llamada')
   AND c.senal IS NULL;

-- Y ahora sí: los dos estados se funden en Respondido.
UPDATE public.captaciones
   SET estado_whatsapp = 'Respondido'
 WHERE estado_whatsapp IN ('Interesado', 'Quiere_Llamada');


-- ------------------------------------------------------------
-- 4. El reparto pasa a mirar la señal
--
-- Sustituye al trigger de la 020, que miraba estado_whatsapp. Mismo criterio de
-- negocio —se reparte a quien ha mostrado interés, no lo recién scrapeado— pero
-- leído de donde ahora vive.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS captaciones_reparto_interes ON public.captaciones;
DROP TRIGGER IF EXISTS captaciones_reparto_interes_alta ON public.captaciones;

DROP TRIGGER IF EXISTS captaciones_reparto_senal ON public.captaciones;
CREATE TRIGGER captaciones_reparto_senal
  BEFORE UPDATE OF senal ON public.captaciones
  FOR EACH ROW
  WHEN (NEW.senal IS NOT NULL AND OLD.senal IS DISTINCT FROM NEW.senal)
  EXECUTE FUNCTION public.repartir_captacion_interesada();

DROP TRIGGER IF EXISTS captaciones_reparto_senal_alta ON public.captaciones;
CREATE TRIGGER captaciones_reparto_senal_alta
  BEFORE INSERT ON public.captaciones
  FOR EACH ROW
  WHEN (NEW.senal IS NOT NULL)
  EXECUTE FUNCTION public.repartir_captacion_interesada();


-- ------------------------------------------------------------
-- 5. El botón de repartir, igual
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
       AND senal IS NOT NULL
       AND activo IS NOT FALSE
       AND telefono IS NOT NULL
       AND telefono <> ''
     -- El que lleva más tiempo esperando a que le llamen, primero.
     ORDER BY senal_en ASC NULLS LAST, id ASC
     LIMIT GREATEST(p_tope, 0)
  LOOP
    SELECT s.agente_id, s.motivo, s.cursor_nuevo
      INTO v_agente, v_motivo, v_cursor
      FROM public.siguiente_agente(r.telefono, COALESCE(r.rechazado_por, '{}')) s;

    IF v_agente IS NULL THEN
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


-- ------------------------------------------------------------
-- 6. Los índices que miraban los estados viejos
-- ------------------------------------------------------------
DROP INDEX IF EXISTS captaciones_sin_atender_idx;
CREATE INDEX IF NOT EXISTS captaciones_sin_atender_idx
  ON public.captaciones (agente_id, senal_en)
  WHERE atendido_en IS NULL AND activo AND senal IS NOT NULL;

CREATE INDEX IF NOT EXISTS captaciones_senal_idx
  ON public.captaciones (senal, senal_en DESC) WHERE senal IS NOT NULL;


-- ------------------------------------------------------------
-- 7. Los dos valores viejos, archivados (no borrados)
--
-- `activo = false` los saca de las pastillas y de los desplegables, pero no los
-- borra: hay 95 filas de `historial_cambios` que los nombran y tienen que
-- seguir leyéndose. El trigger de validación mira `tipo` y `valor`, no `activo`,
-- así que una fila antigua sigue siendo válida.
-- ------------------------------------------------------------
UPDATE public.catalogos
   SET activo = false
 WHERE tipo = 'estado_whatsapp'
   AND valor IN ('Interesado', 'Quiere_Llamada');


-- ------------------------------------------------------------
-- 8. La señal entra en la lista del día
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mi_dia WITH (security_invoker = true) AS
WITH todo AS (
  SELECT 'captacion'::text AS ambito, c.id::text AS id, c.agente_id,
         COALESCE(c.calle, c.nombre) AS titulo, c.barrio, c.telefono,
         c.proximo_toque, c.proximo_motivo, c.atendido_en,
         COALESCE(c.senal, c.estado_whatsapp) AS senal, c.created_at AS entro_en
    FROM public.captaciones c
   WHERE c.activo AND c.prospecto_id IS NULL AND c.agente_id IS NOT NULL
  UNION ALL
  SELECT 'prospecto', p.id::text, p.agente_id,
         COALESCE(p.direccion, l.nombre), p.barrio, l.telefono,
         p.proximo_toque, p.proximo_motivo, p.atendido_en, p.estado, p.created_at
    FROM public.prospectos p
    JOIN public.leads l ON l.id = p.contacto_id
   WHERE p.estado NOT IN ('Captado', 'Perdido')
  UNION ALL
  SELECT 'lead', l.id::text, l.agente_id,
         COALESCE(NULLIF(btrim(l.nombre || ' ' || COALESCE(l.apellidos, '')), ''), 'Sin nombre'),
         NULL, l.telefono,
         l.proximo_toque, l.proximo_motivo, l.atendido_en, l.estado, l.fecha_creacion
    FROM public.leads l
   WHERE l.duplicado_de IS NULL
     AND l.agente_id IS NOT NULL
     AND l.captacion_id IS NULL
     AND l.fuente IS DISTINCT FROM 'Captaciones'
     AND l.estado NOT IN ('Ganado', 'Perdido')
)
SELECT t.*,
       CASE
         WHEN t.proximo_toque IS NOT NULL AND t.proximo_toque <= now() THEN 0
         WHEN t.atendido_en IS NULL                                    THEN 1
         WHEN t.proximo_toque IS NOT NULL                              THEN 2
         ELSE 3
       END AS prioridad
  FROM todo t;


-- ------------------------------------------------------------
-- 9. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- No debe quedar ninguna captación en los estados viejos:
--   SELECT count(*) FROM public.captaciones
--    WHERE estado_whatsapp IN ('Interesado','Quiere_Llamada');   -- 0
--
--   -- Y la señal tiene que haber recogido las 95:
--   SELECT senal, count(*) FROM public.captaciones
--    WHERE senal IS NOT NULL GROUP BY senal;   -- interesado 68, quiere_llamada 27
--
--   SELECT estado_whatsapp, count(*) FROM public.captaciones
--    WHERE activo GROUP BY estado_whatsapp ORDER BY 2 DESC;   -- Respondido ~241
--
--   -- Que el reparto sigue encontrando a los interesados sin agente:
--   SELECT count(*) FROM public.captaciones
--    WHERE agente_id IS NULL AND senal IS NOT NULL AND activo IS NOT FALSE
--      AND telefono <> '';
--
--   -- Los triggers de reparto: deben ser los dos de `senal` y ninguno más:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.captaciones'::regclass AND NOT tgisinternal
--      AND tgname LIKE '%reparto%';
