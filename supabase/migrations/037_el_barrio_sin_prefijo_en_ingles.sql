-- ============================================================
-- MIGRACIÓN 037: el barrio sin "Subdistrict" ni "District"
--
-- DE DÓNDE SALE ESTO.
-- Idealista da el barrio en inglés y con prefijo: "Subdistrict El Pilar",
-- "District Camins al Grau". El scraper lo guardaba tal cual y a 17/09/2026 lo
-- tenían 316 de las 583 captaciones con barrio (300 Subdistrict, 16 District).
-- Salía así en la lista, el kanban, la ficha, Mi día, el chat y el "Copiar
-- ficha". Los mensajes al propietario y los avisos ya lo quitaban al vuelo, pero
-- sólo para redactar.
--
-- POR QUÉ UN TRIGGER Y NO SÓLO EL SCRAPER.
-- El 17/09 se arregló también el nodo "Normalizar Inmuebles" del workflow 1, y
-- eso cubre lo que entra hoy. Pero no es la única puerta: los scrapers antiguos
-- de venta y alquiler (inactivos) escriben el nivel 4 crudo, y hay filas creadas
-- a mano. El trigger limpia venga de donde venga.
--
-- POR QUÉ NO ROMPE NADA.
-- Se auditaron todos los usos del barrio (CRM, SQL y los 54 workflows de n8n):
-- sólo se enseña, se busca con ilike o se copia. Nadie lo compara por igualdad
-- ni hay reglas guardadas con el prefijo (perfiles.zonas vacío, 0 filas de
-- catálogo 'zona', siguiente_agente no lo lee).
-- El UPDATE de abajo no dispara el reparto ni el aviso de asignación: los
-- triggers de captaciones van por agente_id, senal y estado_whatsapp, y el
-- aviso compara el agente de antes y el de después (probado el 17/09 con el
-- agente de pruebas: realtime entrega la fila anterior completa).
--
-- EL PATRÓN. Espacio literal y sin distinguir mayúsculas, igual que el nodo
-- "Analizar Inmueble" del workflow 4. No se toca "Barrio de Favara" ni los
-- "Zona ...": ésos son el nombre de verdad.
-- ============================================================

CREATE OR REPLACE FUNCTION public.barrio_sin_prefijo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.barrio IS NOT NULL THEN
    NEW.barrio := NULLIF(btrim(regexp_replace(NEW.barrio, '^(sub)?district +', '', 'i')), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS captaciones_barrio_sin_prefijo ON public.captaciones;
CREATE TRIGGER captaciones_barrio_sin_prefijo
  BEFORE INSERT OR UPDATE OF barrio ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.barrio_sin_prefijo();

-- Las que ya están dentro. El trigger haría lo mismo con SET barrio = barrio,
-- pero así se lee qué pasa sin tener que ir a buscar la función.
UPDATE public.captaciones
SET barrio = NULLIF(btrim(regexp_replace(barrio, '^(sub)?district +', '', 'i')), '')
WHERE barrio ~* '^(sub)?district ';

-- Comprobación: tiene que dar 0.
SELECT count(*) AS siguen_con_prefijo
FROM public.captaciones
WHERE barrio ~* '^(sub)?district ';
