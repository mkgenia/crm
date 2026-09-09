-- ============================================================
-- MIGRACIÓN 003: Captador v2 (scraper Idealista + cola de WhatsApp)
-- Ejecutar en Supabase SQL Editor. Es idempotente y no destructiva.
-- ============================================================

-- ------------------------------------------------------------
-- 1. captaciones: reserva de contacto, control de fotos e histórico de precio
-- ------------------------------------------------------------
ALTER TABLE public.captaciones
  ADD COLUMN IF NOT EXISTS contacto_lock_en      timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_contacto_en    timestamptz,
  ADD COLUMN IF NOT EXISTS fotos_procesadas      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precio_anterior       numeric,
  ADD COLUMN IF NOT EXISTS precio_actualizado_en timestamptz;

COMMENT ON COLUMN public.captaciones.contacto_lock_en IS
  'Reserva atómica de un turno de la cola. La fija un PATCH condicional '
  '(?contacto_lock_en=is.null) antes de gastar IA o WhatsApp: si el PATCH no devuelve '
  'fila, otro turno ya la tiene. Se suelta sola a las 2h si el envío nunca llegó a salir.';

COMMENT ON COLUMN public.captaciones.ultimo_contacto_en IS
  'Sello del intento de envío, escrito JUSTO ANTES de llamar a Evolution. Es lo que '
  'garantiza que un envío que sale pero cuya respuesta se pierde no se repita: la fila '
  'deja de ser elegible aunque el estado_whatsapp se quedara a medias. Alimenta también '
  'el tope diario de mensajes.';

COMMENT ON COLUMN public.captaciones.fotos_procesadas IS
  'true cuando las fotos ya se descargaron, convirtieron a WebP y subieron al bucket. '
  'Evita reprocesar las mismas imágenes en cada pasada del scraper.';

-- ------------------------------------------------------------
-- 2. estado_whatsapp: dos estados terminales nuevos
--    Sin_WhatsApp → el número existe pero no tiene cuenta de WhatsApp.
--    Duplicado    → el mismo propietario ya recibió mensaje por otro anuncio suyo.
--    Ambos son explícitos a propósito: sacar una fila de la cola dejándola en NULL
--    obliga a adivinar después si "nunca se intentó" o "se intentó y no salió".
-- ------------------------------------------------------------
ALTER TABLE public.captaciones DROP CONSTRAINT IF EXISTS captaciones_estado_whatsapp_check;

ALTER TABLE public.captaciones
  ADD CONSTRAINT captaciones_estado_whatsapp_check
  CHECK (estado_whatsapp = ANY (ARRAY[
    'Pendiente'::text,
    'Enviado'::text,
    'Respondido'::text,
    'Interesado'::text,
    'Quiere_Llamada'::text,
    'No_Interesado'::text,
    'Sin_WhatsApp'::text,
    'Duplicado'::text
  ]));

-- ------------------------------------------------------------
-- 2b. "Sin contactar" tiene que ser NULL y solo NULL
--
--     La columna arrastra un DEFAULT 'Pendiente' que no está en ninguna migración
--     del repo: por eso hay 71 captaciones con ese valor y ninguna con NULL. Como la
--     cola busca `estado_whatsapp=is.null`, con el default puesto podría no ver nunca
--     una captación nueva y el captador parecería funcionar sin enviar nada.
--
--     Las 71 filas históricas se dejan como están A PROPÓSITO: son captaciones que
--     nunca se contactaron, y meterlas de golpe en la cola serían 71 WhatsApps a
--     personas reales. Quedan fuera del automatismo y se rescatan de una en una con
--     el botón "Reintentar" del panel de detalle, que las pasa a NULL.
--
--     LAS DOS SENTENCIAS VAN JUNTAS. La columna es NOT NULL: quitar solo el DEFAULT
--     deja cualquier INSERT que omita el campo (lo hacen todos los workflows) con un
--     NULL que viola la restricción, y la ingesta de captaciones se cae entera con
--     un 400. Hay que permitir NULL, que es lo que el diseño usa para "en cola".
ALTER TABLE public.captaciones ALTER COLUMN estado_whatsapp DROP NOT NULL;
ALTER TABLE public.captaciones ALTER COLUMN estado_whatsapp DROP DEFAULT;

-- Para revisarlas en el CRM:
--   SELECT id, nombre, calle, barrio, precio, created_at FROM public.captaciones
--   WHERE estado_whatsapp = 'Pendiente' AND activo ORDER BY created_at DESC;

-- NOTA: aquí NO hay backfill de contacto_lock_en.
-- La cola exige estado_whatsapp=is.null AND contacto_lock_en=is.null, así que todo lo
-- ya contactado (estado_whatsapp <> NULL) queda fuera por la primera condición sola.
-- Un backfill del lock sobre esas mismas filas no cambiaría la elegibilidad de ninguna.
--
-- Tampoco hay backfill de fotos_procesadas. El flujo antiguo escribía en `imagenes`
-- URLs con forma correcta (…/captaciones/<id>/img_0.webp) que apuntan a objetos que
-- nunca llegaron al bucket: subía todo a captaciones/undefined/img_undefined.webp. Dar
-- esas filas por procesadas desactivaría para siempre la repesca de imágenes del
-- workflow 2, que es justo lo que tiene que arreglarlas.

-- ------------------------------------------------------------
-- 3. Normalizar los teléfonos históricos a 34XXXXXXXXX
--
--    El scraper antiguo guardaba contactInfo.phone1.phoneNumber en crudo (9 dígitos,
--    sin prefijo) y el contacto manual del CRM guardaba lo que tecleara el agente.
--    La cola nueva manda captaciones.telefono tal cual a Evolution, así que sin esto
--    todo el histórico daría exists:false y quedaría marcado Sin_WhatsApp para siempre.
--
--    No se borra nada: lo que no encaje en un fijo/móvil español se deja intacto para
--    que el agente lo siga viendo, y la cola lo descarta con su filtro telefono=like.34*
-- ------------------------------------------------------------
UPDATE public.captaciones c
SET telefono = n.norm
FROM (
  SELECT id,
         CASE
           WHEN d ~ '^0034[6-9][0-9]{8}$' THEN substring(d FROM 3)
           WHEN d ~ '^34[6-9][0-9]{8}$'   THEN d
           WHEN d ~ '^[6-9][0-9]{8}$'     THEN '34' || d
           ELSE NULL
         END AS norm
  FROM (
    SELECT id, regexp_replace(COALESCE(telefono, ''), '\D', '', 'g') AS d
    FROM public.captaciones
  ) t
) n
WHERE c.id = n.id
  AND n.norm IS NOT NULL
  AND c.telefono IS DISTINCT FROM n.norm;

-- Cuántos quedan sin normalizar (revisar a mano si el número es alto):
--   SELECT count(*) FROM public.captaciones
--   WHERE telefono IS NOT NULL AND telefono !~ '^34[6-9][0-9]{8}$';

-- ------------------------------------------------------------
-- 4. scraper_zonas: telemetría de ejecución (se muestra en el panel del CRM)
-- ------------------------------------------------------------
ALTER TABLE public.scraper_zonas
  ADD COLUMN IF NOT EXISTS ultima_ejecucion timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_resultado integer;

-- ------------------------------------------------------------
-- 5. leads: un lead como máximo por captación
--    El CRM usa .maybeSingle() sobre captacion_id y revienta si hay duplicados.
--    No se borra nada automáticamente: si los hay, avisa y deja el índice sin crear.
-- ------------------------------------------------------------
DO $$
DECLARE dups integer;
BEGIN
  SELECT count(*) INTO dups FROM (
    SELECT captacion_id
    FROM public.leads
    WHERE captacion_id IS NOT NULL
    GROUP BY captacion_id
    HAVING count(*) > 1
  ) t;

  IF dups > 0 THEN
    RAISE WARNING 'leads: % captaciones tienen más de un lead. Índice único NO creado. Revísalos y ejecuta el bloque 5b.', dups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS leads_captacion_id_uidx ON public.leads (captacion_id);
  END IF;
END $$;

-- 5b. SOLO si el bloque anterior avisó de duplicados. Revisa antes de ejecutar:
--
--   SELECT captacion_id, count(*) FROM public.leads
--   WHERE captacion_id IS NOT NULL GROUP BY captacion_id HAVING count(*) > 1;
--
-- DELETE FROM public.leads a USING public.leads b
--  WHERE a.captacion_id IS NOT NULL AND a.captacion_id = b.captacion_id AND a.ctid > b.ctid;
-- CREATE UNIQUE INDEX IF NOT EXISTS leads_captacion_id_uidx ON public.leads (captacion_id);

-- 5c. Unificar el valor de `fuente`. Convivían tres etiquetas para el mismo origen:
--     "Captaciones" (workflows antiguos y filtro del CRM), "Captacion" (webhook del CRM)
--     y "Captación" (crearLeadDesdeCaptacion). Se deja la del filtro de /leads.
UPDATE public.leads SET fuente = 'Captaciones'
WHERE fuente IN ('Captacion', 'Captación');

-- ------------------------------------------------------------
-- 6. Índices de apoyo para los filtros del captador
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS captaciones_en_cola_idx
  ON public.captaciones (created_at DESC)
  WHERE estado_whatsapp IS NULL AND contacto_lock_en IS NULL AND ultimo_contacto_en IS NULL;

CREATE INDEX IF NOT EXISTS captaciones_estado_whatsapp_idx
  ON public.captaciones (estado_whatsapp);

CREATE INDEX IF NOT EXISTS captaciones_telefono_idx
  ON public.captaciones (telefono);

CREATE INDEX IF NOT EXISTS captaciones_sin_fotos_idx
  ON public.captaciones (id) WHERE fotos_procesadas = false;

-- ------------------------------------------------------------
-- 7. Ajustes del captador (los lee n8n, los edita el CRM)
-- ------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES
  ('auto_contact_enabled', 'false'::jsonb),
  ('wa_limite_diario',     '25'::jsonb),
  ('apify_uso_mes',        '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_settings IS
  'auto_contact_enabled: bool, interruptor global del auto-contacto. '
  'wa_limite_diario: int, tope de WhatsApps por dia (automaticos + manuales). '
  'apify_uso_mes: json publicado por el workflow 1 con el gasto real del ciclo.';

-- ------------------------------------------------------------
-- 8. Varias zonas activas a la vez
--    El captador mete todas las zonas activas en un unico run de Apify, asi que
--    el arranque del actor ($0.007) se paga una vez y no una por zona. Deja de
--    tener sentido la restriccion de "solo una activa" que aplicaba el CRM.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS scraper_zonas_activa_idx
  ON public.scraper_zonas (activa) WHERE activa = true;
