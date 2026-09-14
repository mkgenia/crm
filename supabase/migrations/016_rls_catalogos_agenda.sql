-- ============================================================
-- MIGRACIÓN 016: políticas de acceso para `agenda` y `catalogos`
--
-- Las dos tablas se crearon con RLS activado y SIN ninguna política, que es la
-- combinación que no avisa de nada: la tabla existe, tiene filas, las consultas
-- devuelven 200 OK... y cero resultados. No hay error que leer en ningún sitio.
--
-- Es lo que estuvo pasando con el calendario desde el 11/09/2026: la cita de la
-- landing se creaba bien, la fila estaba ahí, y la pantalla salía vacía. Se
-- buscó el fallo en el despliegue y en el código durante un buen rato. No era
-- ninguno de los dos.
--
-- Y `catalogos` acababa de repetirlo: 42 valores sembrados, pantalla en blanco.
--
-- El detalle que lo explica: `createAdminClient()` del CRM se llama "admin" pero
-- NO se salta RLS — pasa las cookies del usuario, así que @supabase/ssr usa ese
-- JWT y la petición corre como el usuario autenticado. Lo dice su propio
-- comentario en src/lib/supabase/server.ts. El que se la salta es
-- `createServiceClient()`.
--
-- Estas políticas dan a los usuarios que han iniciado sesión el mismo acceso que
-- ya tienen a `leads`, `perfiles` y `captaciones`. Quien no ha iniciado sesión
-- sigue sin ver nada.
--
-- OJO, esto NO arregla el agujero de seguridad de `leads`, `perfiles` y
-- `captaciones`, que hoy no tienen RLS en absoluto y los lee cualquiera con la
-- clave anónima — y esa clave va dentro del JavaScript del navegador. Eso es
-- otra conversación y otra migración.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- catalogos
--
-- Leer, cualquiera que haya iniciado sesión: un agente necesita el desplegable
-- de estados para mover un lead.
--
-- Escribir, también autenticado: quien comprueba que eres administrador es la
-- acción de servidor (`crearValor`, `actualizarValor`, `archivarValor` miran
-- `sesion.isAdmin` antes de tocar nada). Duplicar esa comprobación aquí
-- obligaría a que la política consultara `perfiles` en cada fila.
-- ------------------------------------------------------------
ALTER TABLE public.catalogos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogos_lectura ON public.catalogos;
CREATE POLICY catalogos_lectura ON public.catalogos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogos_escritura ON public.catalogos;
CREATE POLICY catalogos_escritura ON public.catalogos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- lead_etiquetas
-- ------------------------------------------------------------
ALTER TABLE public.lead_etiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_etiquetas_todo ON public.lead_etiquetas;
CREATE POLICY lead_etiquetas_todo ON public.lead_etiquetas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- agenda
--
-- Aquí sí importa quién es quién, pero el filtro ya lo hace el servidor:
-- `getAgendaMes()` añade `.eq("agente_id", userId)` cuando no eres
-- administrador, y `puedeTocar()` decide si puedes editar una entrada ajena.
-- La política deja pasar a los autenticados y el reparto fino lo sigue haciendo
-- el código, que es donde está escrito y donde se puede leer.
-- ------------------------------------------------------------
ALTER TABLE public.agenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_todo ON public.agenda;
CREATE POLICY agenda_todo ON public.agenda
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- Comprobación tras ejecutar
-- ------------------------------------------------------------
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND tablename IN ('catalogos','agenda','lead_etiquetas');
--
--   SELECT tablename, policyname, roles, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('catalogos','agenda','lead_etiquetas')
--    ORDER BY tablename;
--   -- Deben salir cuatro políticas para el rol {authenticated}.
