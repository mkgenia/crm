-- ============================================================
-- MIGRACIÓN 011: estado "Traspaso" para las captaciones
--
-- Hay locales anunciados que en realidad son TRASPASOS: lo que se vende es el
-- negocio, no el inmueble. No interesan, y escribirles gasta cupo diario de
-- WhatsApp — que desde el bloqueo del 10/09/2026 son 15 mensajes al día.
--
-- El captador ya los detecta en la ingesta (nodo "Marcar Traspasos" de
-- `2 · Captador — Ingesta y Fotos`) y los deja fuera de la cola poniéndoles
-- `activo = false`, porque el CHECK de `estado_whatsapp` no admitía un valor
-- nuevo y un insert rechazado habría perdido la captación entera.
--
-- `activo = false` consigue el efecto pero no dice el MOTIVO: se confunde con
-- los anuncios que desaparecieron de Idealista. Con este estado se distingue un
-- traspaso descartado a propósito de una captación caída.
--
-- Tras ejecutarla hay que cambiar el nodo "Marcar Traspasos" para que ponga
-- también `estado_whatsapp = 'Traspaso'`.
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
    'Duplicado',
    'Traspaso'
  ));

-- Las ocho que ya se apartaron a mano el 11/09/2026: se les pone el motivo.
-- Sólo las que siguen sin estado, para no pisar nada de lo ya contactado.
UPDATE public.captaciones
SET estado_whatsapp = 'Traspaso'
WHERE activo = false
  AND estado_whatsapp IS NULL
  AND descripcion ~* '(\yse\s+traspasa\w*)|(\yen\s+traspaso\y)|(^\s*[*#"''[:space:]]*traspaso\y)|(\ytraspaso\s+de\s+negocio)|(\ytraspaso\s+vending)|(\ytraspaso\s+de\s+(local|parada|peluquer|cafeter|bar|restaurante|tienda|kiosco))';

-- Comprobación tras ejecutar:
--   SELECT estado_whatsapp, count(*) FROM public.captaciones GROUP BY 1 ORDER BY 2 DESC;
