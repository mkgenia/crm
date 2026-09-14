-- ============================================================
-- MIGRACIÓN 018: interacciones, y el motivo de por qué se pierde un lead
--
-- Las dos cosas que el documento de arquitectura pide en más sitios y que hoy
-- no existen en ninguna parte.
--
-- INTERACCIONES. De los 145 requisitos que no se cumplen, la mayoría cuelgan de
-- esta tabla: sin un registro de qué se ha hablado con cada contacto no hay
-- historial (sección 2), ni cadencia de seguimiento (7), ni traspaso decente de
-- la IA al agente (9), ni panel del agente que valga (18). Hoy todo eso se
-- escribe como texto libre dentro de `leads.notas`, y cada workflow la pisa
-- entera al escribir — la landing lo hace literalmente en el paso 3.
--
-- MOTIVO DE PÉRDIDA. Hay 135 leads en estado 'Perdido' y ni uno dice por qué.
-- No se puede saber si se pierden por precio, por zona o porque nadie llamó,
-- que es justo lo que habría que saber para arreglarlo.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Interacciones
--
-- Una fila por cosa que pasa con un contacto. Sirve tanto para leads como para
-- captaciones porque son las dos puntas del mismo negocio y el agente quiere
-- ver una sola línea de tiempo, no dos.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interacciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id      uuid   REFERENCES public.leads(id)       ON DELETE CASCADE,
  captacion_id bigint REFERENCES public.captaciones(id) ON DELETE CASCADE,

  -- Del catálogo 'tipo_interaccion', para que se puedan añadir tipos nuevos sin
  -- migración: el día que se integre la centralita hará falta 'llamada_perdida'
  -- y nadie querrá desplegar por eso.
  tipo       text NOT NULL,
  direccion  text NOT NULL DEFAULT 'interna',   -- entrante | saliente | interna
  canal      text,                              -- whatsapp | telefono | email | web | crm

  -- Una línea legible. Es lo que se ve en la lista sin abrir nada, así que se
  -- guarda ya redactada en vez de componerla en cada pantalla.
  resumen    text NOT NULL,
  -- El cuerpo entero, si lo hay: el mensaje, la nota larga, la transcripción.
  detalle    text,

  agente_id  uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  -- true = la escribió un workflow. Distinguirlo importa: "te llamó Ana" y "el
  -- bot le mandó un WhatsApp" no son lo mismo para quien lee la ficha.
  automatica boolean NOT NULL DEFAULT false,

  -- Cuándo pasó, que no siempre es cuándo se guardó: un agente apunta el martes
  -- una llamada del lunes.
  ocurrida_en timestamptz NOT NULL DEFAULT now(),
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Una interacción que no cuelga de nadie no la va a ver nunca nadie.
  CONSTRAINT interacciones_tiene_dueno
    CHECK (lead_id IS NOT NULL OR captacion_id IS NOT NULL),
  CONSTRAINT interacciones_direccion_check
    CHECK (direccion IN ('entrante', 'saliente', 'interna'))
);

-- La consulta de siempre es "la ficha de este contacto, lo más reciente arriba".
CREATE INDEX IF NOT EXISTS interacciones_lead_idx
  ON public.interacciones (lead_id, ocurrida_en DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interacciones_captacion_idx
  ON public.interacciones (captacion_id, ocurrida_en DESC) WHERE captacion_id IS NOT NULL;
-- Y para el panel del agente: "qué he hecho hoy".
CREATE INDEX IF NOT EXISTS interacciones_agente_idx
  ON public.interacciones (agente_id, ocurrida_en DESC) WHERE agente_id IS NOT NULL;

-- RLS desde el principio y CON política. Las tablas `agenda` y `catalogos` se
-- crearon con RLS y sin política, y el resultado fue dos pantallas en blanco que
-- devolvían 200 OK sin una sola fila y sin ningún error que leer. No se repite.
ALTER TABLE public.interacciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interacciones_todo ON public.interacciones;
CREATE POLICY interacciones_todo ON public.interacciones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. Los tipos, al catálogo
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, sistema) VALUES
  ('tipo_interaccion', 'whatsapp',       'WhatsApp',           'emerald', 10, true),
  ('tipo_interaccion', 'llamada',        'Llamada',            'sky',     20, true),
  ('tipo_interaccion', 'email',          'Email',              'indigo',  30, true),
  ('tipo_interaccion', 'nota',           'Nota',               'slate',   40, true),
  ('tipo_interaccion', 'visita',         'Visita',             'violet',  50, true),
  ('tipo_interaccion', 'cambio_estado',  'Cambio de estado',   'amber',   60, true),
  ('tipo_interaccion', 'formulario',     'Formulario web',     'cyan',    70, true),
  ('tipo_interaccion', 'asignacion',     'Asignación',         'gray',    80, true)
ON CONFLICT (tipo, valor) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Por qué se pierde un lead
--
-- Columna suelta y no una interacción: es el estado final del lead, se consulta
-- al agregar ("¿cuántos perdemos por precio?") y meterlo en una tabla de
-- eventos obligaría a un JOIN en cada informe.
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS motivo_perdida text,
  ADD COLUMN IF NOT EXISTS perdido_en     timestamptz;

COMMENT ON COLUMN public.leads.motivo_perdida IS
  'Valor del catálogo tipo=motivo_perdida. Se pide al pasar un lead a Perdido. '
  'Los 135 que ya estaban perdidos antes de la 018 lo tienen a NULL: no se '
  'inventa un motivo que nadie llegó a decir.';

CREATE INDEX IF NOT EXISTS leads_motivo_perdida_idx
  ON public.leads (motivo_perdida) WHERE motivo_perdida IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Apuntar una interacción
--
-- Función y no INSERT suelto para que los workflows de n8n puedan registrar sin
-- conocer el esquema, y para que el día que se añada una columna no haya que
-- tocar siete workflows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apuntar_interaccion(
  p_lead_id      uuid    DEFAULT NULL,
  p_captacion_id bigint  DEFAULT NULL,
  p_tipo         text    DEFAULT 'nota',
  p_resumen      text    DEFAULT '',
  p_direccion    text    DEFAULT 'interna',
  p_canal        text    DEFAULT NULL,
  p_detalle      text    DEFAULT NULL,
  p_agente_id    uuid    DEFAULT NULL,
  p_automatica   boolean DEFAULT true,
  p_ocurrida_en  timestamptz DEFAULT NULL,
  p_meta         jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_lead_id IS NULL AND p_captacion_id IS NULL THEN
    RAISE EXCEPTION 'Una interacción necesita un lead o una captación';
  END IF;

  INSERT INTO public.interacciones
    (lead_id, captacion_id, tipo, direccion, canal, resumen, detalle,
     agente_id, automatica, ocurrida_en, meta)
  VALUES
    (p_lead_id, p_captacion_id, p_tipo, p_direccion, p_canal,
     COALESCE(NULLIF(p_resumen, ''), p_tipo), p_detalle,
     p_agente_id, p_automatica, COALESCE(p_ocurrida_en, now()), p_meta)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 5. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.interacciones;               -- 0, todavía
--   SELECT valor, nombre FROM public.catalogos WHERE tipo = 'tipo_interaccion' ORDER BY orden;
--   SELECT policyname FROM pg_policies WHERE tablename = 'interacciones';
--
--   -- Una de prueba, y se borra:
--   -- SELECT public.apuntar_interaccion(
--   --   p_lead_id => (SELECT id FROM public.leads LIMIT 1),
--   --   p_tipo => 'nota', p_resumen => 'prueba');
