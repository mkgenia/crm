-- ============================================================
-- MIGRACIÓN 010: arreglar el enlace de la agenda con el lead
--
-- En la 009 declaré `lead_id bigint`, y está mal: `leads.id` es un uuid
-- (`captaciones.id` sí es bigint, de ahí la confusión). Con el tipo mal, la
-- cita que crea la landing al agendar una visita no se puede enlazar al lead:
-- Postgres rechaza el insert con 22P02.
--
-- La columna se recrea en vez de convertirse: la tabla se creó hoy y no tiene
-- ninguna fila, así que no hay nada que perder y un ALTER ... USING con cast
-- de bigint a uuid no existe.
--
-- De paso se ponen las dos claves ajenas que faltaban. Con ON DELETE SET NULL:
-- si alguien borra un lead, su cita no desaparece del calendario del agente
-- —que sigue teniendo esa hora ocupada— simplemente deja de apuntar a nada.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

ALTER TABLE public.agenda DROP COLUMN IF EXISTS lead_id;
ALTER TABLE public.agenda ADD  COLUMN IF NOT EXISTS lead_id uuid;

ALTER TABLE public.agenda DROP CONSTRAINT IF EXISTS agenda_lead_fk;
ALTER TABLE public.agenda
  ADD CONSTRAINT agenda_lead_fk
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.agenda DROP CONSTRAINT IF EXISTS agenda_captacion_fk;
ALTER TABLE public.agenda
  ADD CONSTRAINT agenda_captacion_fk
  FOREIGN KEY (captacion_id) REFERENCES public.captaciones(id) ON DELETE SET NULL;

-- Saltar a la ficha del lead desde una cita es la consulta inversa habitual.
CREATE INDEX IF NOT EXISTS agenda_lead_idx ON public.agenda (lead_id);

-- Comprobación tras ejecutar:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'agenda' AND column_name IN ('lead_id', 'captacion_id');
--   -- lead_id -> uuid, captacion_id -> bigint
