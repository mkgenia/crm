-- ============================================================
-- MIGRACIÓN 033: que la lista del día diga de dónde viene cada fila
--
-- DE DÓNDE SALE ESTO.
-- Mirando la portada del agente, el dueño: "si te fijas ahora tenemos dos listas
-- de leads, algo no muy práctico no crees?".
--
-- Tenía razón, y el motivo es más interesante que la repetición. Hoy en esa
-- pantalla conviven:
--
--   · "LO QUE TOCA HOY"   — sale de esta vista. Ordenada por prioridad, con el
--                           teléfono, el próximo toque y la última nota. Es la
--                           lista con la que se trabaja.
--   · "MIS ÚLTIMOS LEADS" — los seis más nuevos. Lo único que aporta sobre la
--                           otra es UNA COSA: de dónde vino cada uno.
--
-- O sea que la segunda lista no existe porque haga falta: existe porque a la
-- primera le falta una columna. Las mismas personas, dos veces, en la misma
-- pantalla, una de ellas ordenada por algo que a nadie le importa a las nueve de
-- la mañana.
--
-- Y hay un motivo más para traer el origen. Sin él, un lead de Instagram y uno
-- del formulario de la web salen EXACTAMENTE iguales en la lista del día: las
-- dos filas dicen sólo "LEAD". No se trabaja igual a alguien que ha escrito por
-- un anuncio de Instagram que a alguien que ha rellenado un formulario pidiendo
-- una visita, y el agente no tiene forma de saber cuál es cuál sin abrir la
-- ficha.
--
-- QUÉ CAMBIA.
-- La vista devuelve una columna más, `fuente`. Nada más: ni filas nuevas, ni
-- filas que desaparezcan, ni cambios de orden. Las consultas que ya existen
-- nombran sus columnas una a una, así que ninguna se entera.
--
--   · lead      -> su propia `fuente` (Instagram, Propiedades, Web...).
--   · captación -> 'Captaciones', que es de donde vienen todas: las trae el
--                  captador de Idealista. Se escribe el valor del catálogo y no
--                  un literal bonito, para que la pantalla lo traduzca con
--                  `nombreDe` como hace con todo lo demás y siga el nombre que
--                  le ponga el administrador en /configuracion/catalogos.
--   · prospecto -> lo mismo: un prospecto nace SIEMPRE de una captación
--                  (`promocionar_captacion`, migración 022), así que su origen
--                  es el del anuncio del que salió.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La vista, con el origen
--
-- `fuente` VA LA ÚLTIMA, DESPUÉS DE `prioridad`. No es una cuestión de gusto:
-- CREATE OR REPLACE VIEW exige que las columnas que ya existían conserven nombre,
-- tipo Y POSICIÓN, y sólo deja añadir al final. Meterla en medio —después de
-- `entro_en`, que es donde parecía que le tocaba— desplaza una posición a
-- `prioridad` y Postgres corta con:
--
--     ERROR: 42P16: cannot change name of view column "prioridad" to "fuente"
--
-- Y por eso el SELECT final nombra las once columnas una a una en vez de usar
-- `t.*`. Con el asterisco, el orden de la vista lo decide el orden del CTE de
-- arriba, así que cualquier día alguien añade un campo en medio del UNION y se
-- encuentra con el mismo error sin entender de dónde sale. Escritas a mano, el
-- orden está donde se lee.
--
-- Los consumidores (la portada del agente, asignacion.ts, el panel de reparto)
-- piden sus columnas POR NOMBRE, así que a ellos el orden les da igual.
--
-- `security_invoker = true` se mantiene: la vista se lee con los permisos de
-- quien la consulta, que es lo que hace que las RLS de la 029 sigan mandando
-- aquí dentro. Sin eso, una vista es un agujero por el que se ve todo.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_mi_dia WITH (security_invoker = true) AS
WITH todo AS (
  SELECT 'captacion'::text AS ambito, c.id::text AS id, c.agente_id,
         COALESCE(c.calle, c.nombre) AS titulo, c.barrio, c.telefono,
         c.proximo_toque, c.proximo_motivo, c.atendido_en,
         COALESCE(c.senal, c.estado_whatsapp) AS senal, c.created_at AS entro_en,
         'Captaciones'::text AS fuente
    FROM public.captaciones c
   WHERE c.activo AND c.prospecto_id IS NULL AND c.agente_id IS NOT NULL
  UNION ALL
  SELECT 'prospecto', p.id::text, p.agente_id,
         COALESCE(p.direccion, l.nombre), p.barrio, l.telefono,
         p.proximo_toque, p.proximo_motivo, p.atendido_en, p.estado, p.created_at,
         -- Un prospecto siempre viene de una captación (022). Si algún día
         -- naciera de otro sitio, el lead de contacto sabría de dónde.
         COALESCE(l.fuente, 'Captaciones')
    FROM public.prospectos p
    JOIN public.leads l ON l.id = p.contacto_id
   WHERE p.estado NOT IN ('Captado', 'Perdido')
  UNION ALL
  SELECT 'lead', l.id::text, l.agente_id,
         COALESCE(NULLIF(btrim(l.nombre || ' ' || COALESCE(l.apellidos, '')), ''), 'Sin nombre'),
         NULL, l.telefono,
         l.proximo_toque, l.proximo_motivo, l.atendido_en, l.estado, l.fecha_creacion,
         l.fuente
    FROM public.leads l
   WHERE l.duplicado_de IS NULL
     AND l.agente_id IS NOT NULL
     AND l.captacion_id IS NULL
     AND l.fuente IS DISTINCT FROM 'Captaciones'
     AND l.estado NOT IN ('Ganado', 'Perdido')
)
SELECT t.ambito,
       t.id,
       t.agente_id,
       t.titulo,
       t.barrio,
       t.telefono,
       t.proximo_toque,
       t.proximo_motivo,
       t.atendido_en,
       t.senal,
       t.entro_en,
       CASE
         WHEN t.proximo_toque IS NOT NULL AND t.proximo_toque <= now() THEN 0
         WHEN t.atendido_en IS NULL                                    THEN 1
         WHEN t.proximo_toque IS NOT NULL                              THEN 2
         ELSE 3
       END AS prioridad,
       -- La nueva, y por eso la última. Ver el comentario de arriba.
       t.fuente
  FROM todo t;

COMMENT ON VIEW public.v_mi_dia IS
  'Lo que un agente tiene encima de la mesa: captaciones, prospectos y leads en una sola lista, ordenables por `prioridad` (0 vencido, 1 sin tocar nunca, 2 con cita, 3 el resto). Desde la 033 devuelve también `fuente`, para que un lead de Instagram y uno de la web no se lean igual.';


-- ------------------------------------------------------------
-- 2. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- EL ORDEN DE LAS COLUMNAS, que es lo que hizo fallar el primer intento.
--   -- Las doce primeras tienen que salir exactamente así, y `fuente` la trece:
--   SELECT ordinal_position, column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'v_mi_dia'
--    ORDER BY ordinal_position;
--   --  1 ambito · 2 id · 3 agente_id · 4 titulo · 5 barrio · 6 telefono
--   --  7 proximo_toque · 8 proximo_motivo · 9 atendido_en · 10 senal
--   -- 11 entro_en · 12 prioridad · 13 fuente
--
--   -- La columna nueva, y que cada ámbito trae lo suyo:
--   SELECT ambito, fuente, count(*)
--     FROM public.v_mi_dia
--    GROUP BY ambito, fuente
--    ORDER BY ambito, count(*) DESC;
--
--   -- Que NO ha cambiado nada más. Estos dos números tienen que ser los mismos
--   -- que antes de ejecutar (hoy: 7 para el agente de pruebas):
--   SELECT count(*) FROM public.v_mi_dia;
--   SELECT prioridad, count(*) FROM public.v_mi_dia GROUP BY prioridad ORDER BY prioridad;
--
--   -- Y que la fuente que llega es un valor del catálogo, no un texto suelto:
--   SELECT DISTINCT d.fuente,
--          EXISTS (SELECT 1 FROM public.catalogos c
--                   WHERE c.tipo = 'fuente' AND c.valor = d.fuente) AS esta_en_el_catalogo
--     FROM public.v_mi_dia d
--    WHERE d.fuente IS NOT NULL;
--   -- Todas deben salir con true. Una en false se pintaría con su propio valor
--   -- en gris, que se lee, pero conviene darla de alta en /configuracion/catalogos.
