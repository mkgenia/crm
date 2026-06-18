-- ============================================================
-- MIGRACIÓN 001: Limpieza BD + rename terminología
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Eliminar tablas no utilizadas por el CRM ni por n8n
DROP TABLE IF EXISTS public.campaña_leads CASCADE;
DROP TABLE IF EXISTS public.campañas CASCADE;
DROP TABLE IF EXISTS public.mensajes CASCADE;
DROP TABLE IF EXISTS public.mensajes_whatsapp CASCADE;
DROP TABLE IF EXISTS public.marketing_templates CASCADE;
DROP TABLE IF EXISTS public.brand_config CASCADE;
DROP TABLE IF EXISTS public.propiedades CASCADE;

-- 2. Renombrar valor "Callback" → "Quiere_Llamada" en estado_whatsapp
--    (más claro para agentes, todo en español)
UPDATE public.captaciones
SET estado_whatsapp = 'Quiere_Llamada'
WHERE estado_whatsapp = 'Callback';

-- Recrear constraint con nuevo valor
ALTER TABLE public.captaciones
  DROP CONSTRAINT IF EXISTS captaciones_estado_whatsapp_check;

ALTER TABLE public.captaciones
  ADD CONSTRAINT captaciones_estado_whatsapp_check
  CHECK (estado_whatsapp = ANY (ARRAY[
    'Pendiente'::text,
    'Enviado'::text,
    'Respondido'::text,
    'Interesado'::text,
    'Quiere_Llamada'::text,
    'No_Interesado'::text
  ]));

-- 3. Limpiar campo "campanas" del JSON de permisos (tabla campañas eliminada)
UPDATE public.perfiles
SET permisos = permisos - 'campanas'
WHERE permisos ? 'campanas';

-- Actualizar el default para nuevos usuarios
ALTER TABLE public.perfiles
  ALTER COLUMN permisos
  SET DEFAULT '{"leads": true, "mensajes": true, "captaciones": true}'::jsonb;
