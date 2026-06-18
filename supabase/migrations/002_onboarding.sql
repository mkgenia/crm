-- MIGRACIÓN 002: Columna onboarding_done en perfiles + REPLICA IDENTITY para Realtime
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS onboarding_done boolean NOT NULL DEFAULT false;

-- Necesario para que Supabase Realtime incluya valores anteriores en UPDATE events
ALTER TABLE public.captaciones REPLICA IDENTITY FULL;
