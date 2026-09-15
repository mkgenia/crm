-- ============================================================
-- MIGRACIÓN 026: el agente de una captación baja también a su lead
--
-- POR QUÉ.
-- Cuando el bot contacta a un propietario se crea un lead espejo de esa
-- captación: la misma persona y la misma conversación, en dos tablas. Si la
-- captación se le asigna a Raúl, ese lead tiene que ser de Raúl. Si no, el
-- propietario le sale a Raúl en la pantalla de captaciones y a nadie en la de
-- leads, que es la que el agente abre por la mañana desde la 024.
--
-- Hasta hoy esto lo hacía a medias `asignarAgenda()` en el CRM, escribiendo
-- `leads.captado_por`. Lo cambié esta tarde para que los traspasos dejaran de
-- borrar al captador —`captado_por` es quién lo TRAJO y no debe pisarse— y al
-- hacerlo me llevé por delante la propagación sin poner nada en su sitio.
--
-- POR QUÉ UN TRIGGER Y NO CÓDIGO DEL CRM.
-- A una captación se le pone agente desde CINCO sitios:
--   1. el panel de la ficha (asignarAgenda)
--   2. la asignación masiva (asignarAgentesMasivo)
--   3. el trigger automático al mostrar interés (020)
--   4. el botón "Repartir" (repartir_interesadas_pendientes, 020)
--   5. el botón "Atendido": quien atiende una captación sin dueño se la queda (021)
-- Tres de los cinco no pasan por TypeScript. En el CRM esto sólo funcionaría a
-- veces, que es peor que no funcionar: nadie sabría cuándo fiarse.
--
-- Requiere la 024 (la columna `leads.agente_id`).
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La propagación
--
-- Va en dos direcciones distintas a propósito:
--
--   agente_id   -> se copia SIEMPRE, también al quitarlo. Si le quitas una
--                  captación a Raúl, Raúl deja de tener también ese lead: son
--                  la misma conversación y no pueden tener dos dueños.
--
--   captado_por -> sólo se rellena si estaba vacío. Ése es quién lo TRAJO y no
--                  cambia nunca, por muchas veces que la captación cambie de
--                  manos. Es lo que hace posible el "captado por Raúl" de la
--                  ficha del prospecto.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bajar_agente_al_lead()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- En un UPDATE, sólo cuando el agente cambia de verdad. Sin esta guarda,
  -- cualquier UPDATE sobre la captación —y el scraper hace muchos: precio,
  -- fotos, visto_en— reescribiría el lead sin necesidad.
  IF TG_OP = 'UPDATE' AND NEW.agente_id IS NOT DISTINCT FROM OLD.agente_id THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads l
     SET agente_id   = NEW.agente_id,
         captado_por = COALESCE(l.captado_por, NEW.agente_id),
         asignado_en = CASE WHEN NEW.agente_id IS NOT NULL THEN COALESCE(NEW.asignado_en, now()) END,
         asignacion_motivo = CASE
           WHEN NEW.agente_id IS NULL THEN 'Se le quitó el agente a la captación'
           ELSE COALESCE(NEW.asignacion_motivo, 'Heredado de la captación')
         END
   WHERE l.captacion_id = NEW.id
     AND l.agente_id IS DISTINCT FROM NEW.agente_id;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS captaciones_bajar_agente ON public.captaciones;
CREATE TRIGGER captaciones_bajar_agente
  AFTER INSERT OR UPDATE OF agente_id ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.bajar_agente_al_lead();


-- ------------------------------------------------------------
-- 2. Ponerse al día con lo que ya hay
--
-- Medido antes de escribir esto: 82 captaciones con agente, 70 de ellas con su
-- lead espejo. Los 70 ya llevaban el agente correcto en `captado_por` —era lo
-- que escribía la versión vieja— así que esto sólo copia ese valor a la columna
-- nueva.
-- ------------------------------------------------------------
UPDATE public.leads l
   SET agente_id   = c.agente_id,
       captado_por = COALESCE(l.captado_por, c.agente_id),
       asignado_en = COALESCE(l.asignado_en, c.asignado_en, now()),
       asignacion_motivo = COALESCE(l.asignacion_motivo, 'Heredado de la captación')
  FROM public.captaciones c
 WHERE l.captacion_id = c.id
   AND c.agente_id IS NOT NULL
   AND l.agente_id IS DISTINCT FROM c.agente_id;


-- ------------------------------------------------------------
-- 3. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Ningún lead espejo debería llevar un agente distinto al de su captación:
--   SELECT count(*) AS descuadrados
--     FROM public.leads l
--     JOIN public.captaciones c ON c.id = l.captacion_id
--    WHERE l.agente_id IS DISTINCT FROM c.agente_id;
--   -- Debe dar 0.
--
--   -- Y probar la propagación en caliente sobre una captación de verdad:
--   --   UPDATE public.captaciones SET agente_id = (SELECT id FROM public.perfiles
--   --     WHERE rol <> 'Admin' LIMIT 1) WHERE id = <una con lead espejo>;
--   --
--   --   SELECT l.agente_id, l.captado_por, l.asignacion_motivo
--   --     FROM public.leads l WHERE l.captacion_id = <la misma>;
