-- ============================================================
-- MIGRACIÓN 007: estado "Sin_Telefono"
--
-- El barrido trae anuncios más antiguos, y ahí hay muchos propietarios que en
-- Idealista han elegido que sólo se les contacte por mensaje de la plataforma:
-- su `contactInfo.contactMethod` es "email" y no publican ningún número.
-- Medido el 10/09: 15 de las 33 captaciones del día, un 45 %.
--
-- Esos anuncios no pueden entrar en la cadena de captación —no hay a quién
-- escribir— pero tampoco son basura: se les puede contactar a mano por el chat de
-- Idealista. Así que se guardan y se marcan, en vez de tirarlos o de apagarlos.
--
-- No se usa `activo = false` a propósito: en este CRM eso significa "eliminada" y
-- las manda a la papelera, como si las hubiera borrado alguien. Y no se reutiliza
-- "Sin_WhatsApp" porque significa otra cosa: que el número existe pero no tiene
-- cuenta de WhatsApp. Aquí directamente no hay número.
--
-- Con `estado_whatsapp` puesto, la cola ya no las coge: su consulta pide
-- estado_whatsapp IS NULL.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

ALTER TABLE public.captaciones DROP CONSTRAINT IF EXISTS captaciones_estado_whatsapp_check;
ALTER TABLE public.captaciones
  ADD CONSTRAINT captaciones_estado_whatsapp_check
  CHECK (estado_whatsapp IS NULL OR estado_whatsapp IN (
    'Pendiente',
    'Enviado',
    'Interesado',
    'Quiere_Llamada',
    'No_Interesado',
    'Respondido',
    'Sin_WhatsApp',
    'Sin_Telefono',
    'Duplicado'
  ));

-- Las que ya entraron sin teléfono: se marcan para que dejen de ocupar sitio en
-- la cola. Sólo las que no tienen ningún estado todavía, para no pisar nada.
UPDATE public.captaciones
SET estado_whatsapp = 'Sin_Telefono'
WHERE telefono IS NULL
  AND estado_whatsapp IS NULL
  AND activo = true;

-- Comprobación tras ejecutar:
--   SELECT estado_whatsapp, count(*) FROM public.captaciones GROUP BY 1 ORDER BY 2 DESC;
--   SELECT count(*) FROM public.captaciones
--   WHERE estado_whatsapp IS NULL AND contacto_lock_en IS NULL
--     AND telefono IS NOT NULL AND activo = true;   -- la cola real
