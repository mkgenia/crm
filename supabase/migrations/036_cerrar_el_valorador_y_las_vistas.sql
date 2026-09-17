-- ============================================================
-- MIGRACIÓN 036: cerrar lo que la 028 y la 029 se dejaron fuera
--
-- DE DÓNDE SALE ESTO.
-- El 17/09/2026 se repitió la prueba de la 028: leer cada tabla con la clave
-- pública, la que va dentro del JavaScript del navegador. Las quince tablas de
-- la 016, la 028 y la 029 contestan cero filas. Estas cinco no:
--
--   perfiles_con_email            8 filas   nombre, EMAIL, TELÉFONO, rol, permisos
--   valoraciones                  2 filas   direcciones de clientes
--   mercado_inmuebles         2.156 filas
--   mercado_precio_historial    228 filas
--   mercado_zonas_stats          76 filas   (vista)
--
-- POR QUÉ SE ESCAPARON.
-- Las tres tablas del valorador nacieron en `supabase/valorador*.sql`, fuera de
-- la carpeta de migraciones, con RLS desactivado a propósito (docs/valorador.md,
-- punto 8: los comparables salían vacíos). La 028 enumeró sus tablas a mano y
-- éstas no estaban en la lista.
--
-- Las vistas son otra cosa, y es la tercera vez que esta familia de fallo muerde
-- (016: RLS sin política; 029: políticas que se suman). UNA VISTA SE EJECUTA CON
-- LOS PERMISOS DE SU DUEÑO, no con los de quien pregunta: `perfiles` está
-- cerrada desde la 028, y `perfiles_con_email` la sigue enseñando entera porque
-- quien lee `perfiles` no es el visitante, es el dueño de la vista.
--
-- POR QUÉ ESTO NO ROMPE EL CRM. El mismo argumento de la 028: todo el CRM habla
-- como `authenticated` (createClient y createAdminClient arrastran la cookie), y
-- n8n habla como `service_role`, que se salta RLS. El workflow del valorador
-- sigue escribiendo igual. Lo único que cambia es que `anon` deja de leer.
--
-- `perfiles_con_email` no la usa nadie: ni una línea de `src/`, ni uno de los 54
-- workflows de n8n (comprobado sobre el volcado de hoy). Se le quita el permiso
-- en vez de borrarla, por si algo de fuera del repo la llamara con service_role.
--
-- SI EL MAPA DEL VALORADOR SE QUEDA EN BLANCO tras ejecutar esto: mirar aquí
-- antes que en el código. Es RLS sin política, que contesta 200 y cero filas.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Las tablas del valorador
--
-- Misma política que las tablas de trabajo de la 028: `authenticated` puede
-- todo. Quién ve qué dentro del equipo lo decide el código.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mercado_inmuebles', 'mercado_precio_historial', 'valoraciones'
  ]
  LOOP
    -- Lección de la 029: las políticas se SUMAN. Primero se tira lo que haya.
    FOR p IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated', t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 2. Las vistas: que pregunten con los permisos de quien mira
--
-- Con `security_invoker` la vista deja de ser un atajo por encima del RLS de su
-- tabla base. Se aplica también a `contactos` y `v_mi_dia`, que hoy salen
-- cerradas: así dejan de depender de cómo se crearon.
--
-- Requiere Postgres 15 o superior, que es lo que sirve Supabase.
-- ------------------------------------------------------------
ALTER VIEW IF EXISTS public.mercado_zonas_stats SET (security_invoker = true);
ALTER VIEW IF EXISTS public.contactos           SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_mi_dia            SET (security_invoker = true);


-- ------------------------------------------------------------
-- 3. perfiles_con_email: fuera del alcance del navegador
--
-- Aquí `security_invoker` no basta ni conviene: la vista cruza con `auth.users`
-- para sacar el email, y ningún rol del navegador debe poder leer eso. Se le
-- retira el permiso a los dos. `service_role` lo conserva.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views
              WHERE schemaname = 'public' AND viewname = 'perfiles_con_email') THEN
    REVOKE ALL ON public.perfiles_con_email FROM anon, authenticated;
  END IF;
END $$;


-- ------------------------------------------------------------
-- 4. Comprobación
--
-- Tiene que devolver las tres tablas con rls = true y una política cada una.
-- La prueba de verdad es la otra: repetir la lectura con la clave pública y
-- que las cinco contesten cero filas (perfiles_con_email, un 401/permiso denegado).
-- ------------------------------------------------------------
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('mercado_inmuebles', 'mercado_precio_historial', 'valoraciones')
 ORDER BY 1;
