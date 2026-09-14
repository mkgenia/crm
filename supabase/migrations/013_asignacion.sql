-- ============================================================
-- MIGRACIÓN 013: asignación de leads
--
-- Hoy hay 925 leads de 1.000 sin agente. No es que la asignación sea manual: es
-- que no se hace. Nadie mira una bandeja porque no existe, y nada la reparte
-- sola porque no hay motor.
--
-- Esto añade las dos piezas que faltan:
--   - En `perfiles`, con qué criterio se reparte (orden, disponibilidad, zonas).
--   - En `leads`, a quién le tocó, cuándo y POR QUÉ.
--
-- El "por qué" no es adorno. Sin él, un agente ve un lead nuevo en su lista y no
-- sabe si se lo puso el jefe, si le tocó por turno o si es suyo de antes; y
-- cuando el reparto parezca injusto no habrá forma de comprobarlo.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Los agentes
-- ------------------------------------------------------------
ALTER TABLE public.perfiles
  -- De vacaciones, de baja o simplemente saturado: el motor lo salta.
  ADD COLUMN IF NOT EXISTS disponible     boolean NOT NULL DEFAULT true,
  -- El orden de prioridad del reparto, del primero al último. Lo decide el
  -- administrador arrastrando en el panel. NULL = fuera de la rotación.
  ADD COLUMN IF NOT EXISTS orden_reparto  integer,
  -- Reglas duras, para cuando se quieran usar. Los valores salen del catálogo
  -- (tipo 'zona' y tipo 'especialidad'), no de texto libre.
  ADD COLUMN IF NOT EXISTS zonas          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS especialidades text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.perfiles.orden_reparto IS
  'Posición en la rotación de reparto automático, empezando en 1. NULL deja al '
  'agente fuera del reparto sin marcarlo como no disponible: sigue trabajando '
  'los leads que ya tiene, pero no le entran nuevos.';

COMMENT ON COLUMN public.perfiles.disponible IS
  'False = vacaciones, baja o fuera de turno. El motor lo salta y sigue con el '
  'siguiente de la rotación, sin dejar el lead sin asignar.';

-- Se siembra la rotación con los agentes que hay, por orden alfabético, para que
-- exista un orden desde el minuto uno. El administrador lo reordena luego.
WITH numerados AS (
  SELECT id, row_number() OVER (ORDER BY nombre) AS n
    FROM public.perfiles
   WHERE rol <> 'Admin'
)
UPDATE public.perfiles p
   SET orden_reparto = numerados.n
  FROM numerados
 WHERE p.id = numerados.id
   AND p.orden_reparto IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS perfiles_orden_reparto_uidx
  ON public.perfiles (orden_reparto) WHERE orden_reparto IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Los leads
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS asignado_en       timestamptz,
  ADD COLUMN IF NOT EXISTS asignado_por      uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignacion_motivo text,
  -- Quién lo ha rechazado ya. El motor los excluye al reasignar, para que un
  -- lead rechazado no vuelva al mismo agente en la siguiente vuelta.
  ADD COLUMN IF NOT EXISTS rechazado_por     uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.leads.asignacion_motivo IS
  'En castellano y legible: "turno de reparto", "continuidad: ya lo llevaba", '
  '"zona Ruzafa", "a mano por Josep". Se enseña en la ficha del lead.';

-- La bandeja del administrador es exactamente esta consulta, así que conviene
-- que no recorra la tabla entera.
CREATE INDEX IF NOT EXISTS leads_sin_asignar_idx
  ON public.leads (fecha_creacion DESC) WHERE captado_por IS NULL;

CREATE INDEX IF NOT EXISTS leads_captado_por_idx
  ON public.leads (captado_por, fecha_creacion DESC) WHERE captado_por IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Ajustes
--
-- 'manual' de partida A PROPÓSITO: es como funciona hoy, y encender el reparto
-- automático el mismo día que se despliega repartiría de golpe todo lo que entre
-- sin que nadie lo haya decidido. Se enciende desde Configuración cuando el
-- orden de agentes esté revisado.
-- ------------------------------------------------------------
INSERT INTO public.app_settings (key, value) VALUES
  ('asignacion_modo',   '"manual"'::jsonb),
  -- Último puesto de la rotación al que le tocó. El motor sigue por el siguiente.
  ('asignacion_cursor', '0'::jsonb),
  -- Reglas duras activas. Vacío = solo rotación, que es lo acordado para empezar.
  ('asignacion_reglas', '{"zona": false, "especialidad": false, "continuidad": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Catálogo: zonas y especialidades
--
-- Van al catálogo como todo lo demás, para que se editen desde el panel en vez
-- de escribirse a mano en cada perfil y acabar con "Ruzafa", "ruzafa" y
-- "Russafa" siendo tres zonas distintas.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, sistema) VALUES
  ('especialidad', 'captacion', 'Captación de propietarios', 'violet', 10, false),
  ('especialidad', 'venta',     'Venta a comprador',         'emerald', 20, false),
  ('especialidad', 'alquiler',  'Alquiler',                  'sky',     30, false),
  ('especialidad', 'comercial', 'Locales y comercial',       'amber',   40, false)
ON CONFLICT (tipo, valor) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   SELECT nombre, rol, disponible, orden_reparto FROM public.perfiles ORDER BY orden_reparto NULLS LAST;
--   -- Los 6 agentes deben salir numerados del 1 al 6, y el Admin con NULL.
--
--   SELECT key, value FROM public.app_settings WHERE key LIKE 'asignacion%';
--   -- modo "manual", cursor 0, reglas con continuidad true.
--
--   SELECT count(*) FROM public.leads WHERE captado_por IS NULL;
--   -- Los que esperan en la bandeja. Hoy son 925.
