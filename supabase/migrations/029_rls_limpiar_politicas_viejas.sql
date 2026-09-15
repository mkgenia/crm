-- ============================================================
-- MIGRACIÓN 029: quitar las políticas viejas que dejaban la puerta abierta
--
-- QUÉ PASÓ CON LA 028.
-- Activó RLS y añadió una política para `authenticated`, y aun así siguió
-- leyéndose todo con la clave pública. Comprobado después de ejecutarla:
--
--   leads                1.077 filas   sigue abierto
--   captaciones            757 filas   sigue abierto
--   historial_cambios      473 filas   sigue abierto
--   app_settings            10 filas   sigue abierto Y SE PUEDE ESCRIBIR
--   scraper_zonas            5 filas   sigue abierto
--   demandas                     0     cerrado
--   propiedades_demanda          0     cerrado
--
-- El motivo: esas tablas YA TENÍAN políticas de antes, permisivas. En Postgres
-- las políticas se SUMAN: basta con que una deje pasar para que se pase. Añadir
-- la mía no cierra nada mientras la vieja siga ahí. Las dos que sí se cerraron
-- son justo las que no tenían ninguna.
--
-- LO MÁS GRAVE es `app_settings`: el rol anónimo puede ESCRIBIR. Ahí viven el
-- interruptor del captador, el tope diario de envíos y el ritmo. Cualquiera con
-- la clave que va en el JavaScript del navegador puede poner el ritmo en
-- 'turbo', que es literalmente cómo WhatsApp bloqueó el número de la empresa 24
-- horas el 10/09/2026.
--
-- QUÉ HACE ESTA MIGRACIÓN.
-- Borra TODAS las políticas de esas tablas —sin necesidad de saber cómo se
-- llaman, que por eso va en un bucle sobre pg_policies— y deja sólo las buenas.
--
-- No toca `catalogos`, `agenda`, `lead_etiquetas`, `interacciones` ni
-- `prospectos`: ésas nacieron con su política correcta (016, 018, 022) y ya
-- están cerradas, comprobado.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Borrar lo viejo
--
-- Se recorre pg_policies y se tira todo lo que haya en estas tablas. Es la
-- única forma honesta: las políticas antiguas no están en ninguna migración de
-- este repositorio —se crearon desde el panel de Supabase— así que no hay una
-- lista de nombres que borrar.
-- ------------------------------------------------------------
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('leads', 'captaciones', 'demandas', 'propiedades_demanda',
                         'historial_cambios', 'scraper_zonas', 'app_settings', 'perfiles')
  LOOP
    RAISE NOTICE 'quitando politica % de %', p.policyname, p.tablename;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 2. Y volver a poner sólo las buenas
--
-- `authenticated` puede todo en las tablas de trabajo: es lo que el CRM hace
-- hoy. Quién ve qué DENTRO del equipo lo decide el código, que filtra por
-- agente; esto es para echar de la sala a quien no ha entrado.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leads', 'captaciones', 'demandas', 'propiedades_demanda',
    'historial_cambios', 'scraper_zonas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated', t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 3. Perfiles: leer sí, tocar sólo el administrador
--
-- Que un agente pueda cambiarle el rol a otro —o ponerse Admin a sí mismo—
-- desde la consola del navegador no es una fuga, es una escalada de privilegios.
-- Leer sí lo necesita todo el mundo: la lista de agentes sale en el reparto, en
-- la ficha, en la línea de tiempo y en el calendario.
-- ------------------------------------------------------------
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY perfiles_lectura ON public.perfiles
  FOR SELECT TO authenticated USING (true);

-- Cada uno edita lo suyo: su nombre, su avatar, si está disponible.
CREATE POLICY perfiles_propio ON public.perfiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY perfiles_admin ON public.perfiles
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ------------------------------------------------------------
-- 4. app_settings: leer sí, escribir SÓLO el administrador
--
-- Es la tabla que hoy estaba abierta a escritura para cualquiera.
-- ------------------------------------------------------------
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_lectura ON public.app_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY app_settings_admin ON public.app_settings
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ------------------------------------------------------------
-- 5. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Qué políticas quedan en cada tabla, y para qué rol. No debe aparecer
--   -- ningún `{public}` ni `{anon}` en la columna roles:
--   SELECT tablename, policyname, roles, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('leads','captaciones','demandas','propiedades_demanda',
--                        'historial_cambios','scraper_zonas','app_settings','perfiles')
--    ORDER BY tablename, policyname;
--
--   -- Y ninguna tabla con RLS puede quedarse sin política: eso da pantallas en
--   -- blanco con 200 OK y sin error, que es el peor fallo posible.
--   SELECT c.relname
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
--      AND NOT EXISTS (SELECT 1 FROM pg_policies p
--                       WHERE p.schemaname='public' AND p.tablename=c.relname);
--   -- Debe salir VACÍO.
