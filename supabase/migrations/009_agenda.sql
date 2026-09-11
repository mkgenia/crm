-- ============================================================
-- MIGRACIÓN 009: agenda del equipo
--
-- Citas, notas y recordatorios. Dos personas distintas por fila:
--
--   agente_id   -> DE QUIÉN es la entrada (quién la ve en su día)
--   creado_por  -> QUIÉN la escribió
--
-- Separarlas es lo que permite que el administrador le apunte una visita a
-- Ana sin que parezca suya, y que Ana vea en su agenda quién se la puso. Si
-- fuera un solo campo habría que elegir entre las dos cosas.
--
-- `fecha` es timestamptz: una cita tiene hora, una nota no. Para las notas se
-- guarda el día a las 00:00 y `todo_el_dia` a true, en vez de inventar una hora
-- falsa que luego se enseñaría en pantalla.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agenda (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       text NOT NULL,
  descripcion  text,
  tipo         text NOT NULL DEFAULT 'cita',
  fecha        timestamptz NOT NULL,
  todo_el_dia  boolean NOT NULL DEFAULT false,
  agente_id    uuid REFERENCES public.perfiles(id) ON DELETE CASCADE,
  creado_por   uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  completado   boolean NOT NULL DEFAULT false,
  -- Enlaces opcionales a lo que ya existe, para poder saltar a la ficha
  captacion_id bigint,
  lead_id      bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agenda DROP CONSTRAINT IF EXISTS agenda_tipo_check;
ALTER TABLE public.agenda
  ADD CONSTRAINT agenda_tipo_check
  CHECK (tipo IN ('cita', 'nota', 'recordatorio'));

-- La consulta de siempre es "qué tiene fulano entre estas dos fechas".
CREATE INDEX IF NOT EXISTS agenda_agente_fecha_idx ON public.agenda (agente_id, fecha);
CREATE INDEX IF NOT EXISTS agenda_fecha_idx        ON public.agenda (fecha);

-- Comprobación tras ejecutar:
--   SELECT count(*) FROM public.agenda;
