-- ============================================================
-- MIGRACIÓN 034: la visita, como tipo propio de la agenda
--
-- DE DÓNDE SALE ESTO.
-- El dueño, mirando la portada del agente: "quiero visita por programar, y si
-- en administrador agenda una visita desde el calendario para él salga ahí".
--
-- Y al ir a contar "visitas por programar" apareció el problema: el calendario
-- sólo conoce Cita, Recordatorio y Nota. Una visita a un piso —que es LA acción
-- del negocio, la que convierte a un interesado en una venta— se apuntaba como
-- "Cita", igual que una firma en la notaría o una reunión de equipo. Así no hay
-- forma de contestar a "¿a cuántos de los que dijeron que sí no les hemos puesto
-- día todavía?".
--
-- LO QUE HAY HOY, medido antes de escribir esto:
--   · 6 entradas en toda la agenda: 5 "cita" y 1 "recordatorio".
--   · 30 captaciones con señal Y agente asignado. De esas 30, CERO tienen
--     ninguna cita puesta.
--   · 29 leads en "Interesado" con agente. 28 sin cita.
--
-- O sea: unas sesenta personas han dicho que sí y no tienen día. Ése es el
-- número que el dueño quiere ver, y por eso la visita necesita nombre propio.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. El tipo nuevo
--
-- `orden = 15` lo pone entre "Cita" (10) y "Recordatorio" (20): en el
-- desplegable del calendario la visita cae justo después de la cita, que es
-- donde la busca quien está acostumbrado a poner citas.
--
-- `sistema = true` como sus tres hermanos: el código cuenta con que este valor
-- exista —la tarjeta "Visita por programar" pregunta por él— y el panel de
-- catálogos no deja borrar los de sistema. El NOMBRE sí se puede cambiar desde
-- /configuracion/catalogos, que es para lo que está la tabla.
--
-- Color emerald: es el verde que este CRM usa para lo que ha salido bien
-- (Ganado, Captado, "Le interesa"). Una visita agendada es exactamente eso.
-- Violeta la tiene la cita, ámbar el recordatorio y cian la nota.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema)
VALUES ('tipo_agenda', 'visita', 'Visita', 'emerald', 15, true, true)
ON CONFLICT (tipo, valor) DO UPDATE
   SET nombre  = COALESCE(NULLIF(public.catalogos.nombre, ''), EXCLUDED.nombre),
       color   = COALESCE(public.catalogos.color, EXCLUDED.color),
       orden   = EXCLUDED.orden,
       activo  = true,
       sistema = true;


-- ------------------------------------------------------------
-- 2. Lo que YA estaba apuntado como visita, que se llame visita
--
-- Antes de hoy la única forma de apuntar una visita era ponerle "Cita" y
-- escribirlo en el título. `atender()` lo hace así desde la 021: el chip
-- "Quedamos en verlo" crea una entrada con el texto de la nota.
--
-- Se reetiquetan SÓLO las que lo dicen en el título o en la descripción, y sólo
-- las que aún no han pasado: una cita de hace tres meses ya se celebró y
-- cambiarle el tipo ahora reescribe el pasado sin que nadie gane nada.
--
-- Hoy esto afecta a MUY POCAS filas (hay 6 entradas en total). Se deja escrito
-- igualmente porque es la diferencia entre estrenar el tipo con los datos
-- ordenados o con dos criterios conviviendo desde el primer día.
-- ------------------------------------------------------------
UPDATE public.agenda
   SET tipo = 'visita'
 WHERE tipo = 'cita'
   AND fecha >= now()
   AND completado IS NOT TRUE
   AND (titulo ILIKE '%visita%' OR titulo ILIKE '%ver el%' OR titulo ILIKE '%verlo%'
     OR descripcion ILIKE '%visita%');


-- ------------------------------------------------------------
-- 3. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- El tipo nuevo, en su sitio y en orden:
--   SELECT valor, nombre, color, orden, activo, sistema
--     FROM public.catalogos WHERE tipo = 'tipo_agenda' ORDER BY orden;
--   -- cita 10 · visita 15 · recordatorio 20 · nota 30
--
--   -- Qué hay en la agenda por tipo, antes y después:
--   SELECT tipo, count(*) FROM public.agenda GROUP BY tipo ORDER BY count(*) DESC;
--
--   -- Y el número que va a enseñar la tarjeta: quién dijo que sí y no tiene día.
--   -- (Aquí para TODO el equipo; la portada lo filtra por agente.)
--   SELECT p.nombre AS agente, count(*) AS sin_visita
--     FROM public.captaciones c
--     JOIN public.perfiles p ON p.id = c.agente_id
--    WHERE c.activo AND c.senal IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.agenda a
--                       WHERE a.captacion_id = c.id
--                         AND a.tipo IN ('visita', 'cita')
--                         AND a.completado IS NOT TRUE)
--    GROUP BY p.nombre ORDER BY sin_visita DESC;
--   -- Medido antes de la migración: Victor 13, Cristina 6, Placido 5, Raul 5, Tester 1.
