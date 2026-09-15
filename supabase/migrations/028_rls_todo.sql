-- ============================================================
-- MIGRACIÓN 028: cerrar la puerta abierta
--
-- EL PROBLEMA, COMPROBADO HOY CON LA CLAVE PÚBLICA DEL NAVEGADOR:
--
--   leads                 1.077 filas   nombre, teléfono, email
--   demandas              1.825 filas   nombre, teléfono
--   captaciones             757 filas
--   historial_cambios       473 filas
--   propiedades_demanda     145 filas
--   perfiles                  7 filas   el equipo
--   app_settings             10 filas
--   scraper_zonas             5 filas
--
-- Todo eso lo lee CUALQUIERA. La clave anónima va dentro del JavaScript que el
-- navegador descarga: se ve con el botón derecho. Son los datos personales de
-- unas 3.600 personas, y hoy hemos metido ahí además precios y direcciones de
-- propietarios, así que hay más expuesto que ayer.
--
-- POR QUÉ ESTO NO ROMPE EL CRM.
-- La pieza clave está en `src/lib/supabase/server.ts`: `createAdminClient()` usa
-- la service key PERO le pasa las cookies del usuario, así que @supabase/ssr
-- coge ese JWT y la petición corre como `authenticated`, no como `service_role`.
-- Lo mismo vale para `createClient()`. Es decir: todo el CRM ya habla como
-- usuario autenticado, y con una política para `authenticated` sigue viendo
-- exactamente lo mismo que ve hoy.
--
-- Y n8n no se entera: sus nodos mandan la service key PELADA, sin cookies, así
-- que PostgREST les da rol `service_role`, que se salta RLS por definición.
-- Los cinco webhooks públicos, la ingesta, la cola y el clasificador siguen
-- escribiendo igual. Las rutas /api/demandas/* usan `createAdminClient()` y las
-- llama n8n sin cookies, así que caen del mismo lado.
--
-- Lo único que cambia es que el rol `anon` deja de poder leer. Que es justo el
-- agujero.
--
-- SI ALGO SE QUEDA EN BLANCO tras ejecutar esto, el motivo será una tabla con
-- RLS y sin política: devuelve 200 OK y cero filas, sin un solo error. Es lo que
-- pasó con `agenda` y `catalogos` en la 016 y costó dos días de pantallas vacías
-- antes de que alguien mirara aquí. Por eso ninguna tabla de este fichero se
-- queda sin su política.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Quién es administrador
--
-- SECURITY DEFINER a propósito: la función tiene que poder leer `perfiles`
-- aunque quien pregunte todavía no tenga permiso para leer `perfiles`. Sin eso,
-- la política de escritura se llamaría a sí misma en bucle.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.perfiles p
     WHERE p.id = auth.uid() AND p.rol = 'Admin'
  );
$fn$;


-- ------------------------------------------------------------
-- 2. Las tablas de trabajo
--
-- `authenticated` puede todo: es lo que el CRM hace hoy, y esta migración no
-- viene a cambiar quién ve qué dentro del equipo —eso ya lo decide el código,
-- que filtra por agente— sino a echar de la sala a quien no ha entrado.
--
-- Afinar por agente dentro de RLS es el siguiente escalón y merece su propia
-- migración: hacerlo aquí, a la vez que se cierra la puerta, mezcla dos cambios
-- y deja sin saber cuál de los dos rompió qué.
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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated', t);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- 3. Perfiles: leer sí, tocar sólo el administrador
--
-- Aquí sí se afina, porque el daño es distinto: que un agente pueda cambiarle el
-- rol a otro —o ponerse Admin a sí mismo— desde la consola del navegador no es
-- una fuga, es una escalada de privilegios.
--
-- Leer sí lo necesita todo el mundo: la lista de agentes sale en el reparto, en
-- la ficha, en la línea de tiempo y en el calendario.
-- ------------------------------------------------------------
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfiles_lectura ON public.perfiles;
CREATE POLICY perfiles_lectura ON public.perfiles
  FOR SELECT TO authenticated USING (true);

-- Cada uno puede editar lo suyo (su nombre, su avatar, si está disponible).
DROP POLICY IF EXISTS perfiles_propio ON public.perfiles;
CREATE POLICY perfiles_propio ON public.perfiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS perfiles_admin ON public.perfiles;
CREATE POLICY perfiles_admin ON public.perfiles
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ------------------------------------------------------------
-- 4. app_settings: leer sí, escribir sólo el administrador
--
-- Aquí viven el interruptor del captador, el tope diario de envíos y el ritmo.
-- Un agente que pudiera escribir aquí podría poner el ritmo en 'turbo' desde la
-- consola del navegador — que es, literalmente, cómo se bloqueó el número de la
-- empresa el 10 de septiembre.
--
-- Leer lo necesita el CRM para pintar el panel.
-- ------------------------------------------------------------
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_lectura ON public.app_settings;
CREATE POLICY app_settings_lectura ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_settings_admin ON public.app_settings;
CREATE POLICY app_settings_admin ON public.app_settings
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ------------------------------------------------------------
-- 5. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Ninguna tabla con RLS puede quedarse sin política: eso da pantallas en
--   -- blanco con 200 OK, que es el peor fallo posible porque no se ve.
--   SELECT c.relname AS tabla
--     FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
--      AND NOT EXISTS (SELECT 1 FROM pg_policies p
--                       WHERE p.schemaname = 'public' AND p.tablename = c.relname)
--    ORDER BY 1;
--   -- Debe salir VACÍO.
--
--   -- Y el resumen de qué está protegido:
--   SELECT c.relname, c.relrowsecurity AS rls,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename=c.relname) AS politicas
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r'
--    ORDER BY c.relrowsecurity DESC, c.relname;
--
-- DESPUÉS DE EJECUTAR, comprobar desde fuera con la clave anónima que ya no se
-- lee nada (lo hará el CRM en su verificación), y abrir el CRM para confirmar
-- que sigue enseñando lo mismo. Si algo apareciera vacío, la causa estará aquí.
