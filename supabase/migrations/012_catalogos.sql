-- ============================================================
-- MIGRACIÓN 012: catálogos editables
--
-- Hoy la taxonomía del CRM vive en dos sitios malos a la vez: en CHECK
-- constraints de Postgres y en listas escritas a mano en 17 ficheros de
-- TypeScript. Añadir un estado o una etiqueta significa una migración Y un
-- despliegue. El 11/09/2026 costó un rato real: no se pudo marcar una captación
-- como 'Traspaso' porque el CHECK no lo admitía, y hubo que apañarlo con
-- `activo = false` hasta poder ejecutar la 011.
--
-- Esta tabla pasa esa taxonomía a datos. El administrador añade un estado, una
-- etiqueta o un motivo de pérdida desde el panel, y no hay que tocar nada más.
--
-- Qué NO hace, a propósito: no cambia ninguna columna existente. `leads.estado`
-- sigue siendo texto, `captaciones.estado_whatsapp` también. Lo único que cambia
-- es QUIÉN decide los valores válidos.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalogos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Qué lista es: estado_lead, etiqueta, fuente, motivo_perdida, tipo_agenda,
  -- estado_whatsapp, zona, especialidad, idioma...
  tipo       text NOT NULL,
  -- Lo que se guarda en las filas. No se toca nunca una vez creado: si se
  -- renombra, se renombra `nombre`, no esto.
  valor      text NOT NULL,
  -- Lo que se ve en pantalla. Aquí sí se puede poner tildes y espacios.
  nombre     text NOT NULL,
  -- Token de color de la interfaz (violet, emerald, amber...). Sin hex: el CRM
  -- tiene modo claro y oscuro y un hex sólo queda bien en uno de los dos.
  color      text,
  orden      integer NOT NULL DEFAULT 100,
  activo     boolean NOT NULL DEFAULT true,
  -- Los de sistema no se pueden borrar desde el panel: hay código que depende de
  -- ellos por su `valor` (el captador escribe 'Enviado', la landing escribe
  -- 'Interesado'). Renombrarlos y recolorearlos sí se puede.
  sistema    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogos_tipo_valor_uidx ON public.catalogos (tipo, valor);
CREATE INDEX IF NOT EXISTS catalogos_tipo_orden_idx ON public.catalogos (tipo, orden) WHERE activo;

-- ------------------------------------------------------------
-- 2. Etiquetas de los leads
--
-- Tabla aparte y no una columna: un lead puede tener varias etiquetas a la vez
-- ("urgente", "inversor", "financiación pendiente"), y guardarlas como texto
-- separado por comas hace imposible filtrar bien.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_etiquetas (
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  etiqueta_id uuid NOT NULL REFERENCES public.catalogos(id) ON DELETE CASCADE,
  puesta_por  uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, etiqueta_id)
);

CREATE INDEX IF NOT EXISTS lead_etiquetas_etiqueta_idx ON public.lead_etiquetas (etiqueta_id);

-- ------------------------------------------------------------
-- 3. Sembrado con lo que HAY VIVO ahora mismo
--
-- Las cifras son de un recuento real del 14/09/2026 sobre las filas de
-- producción, no de lo que dice el código. Así ninguna fila existente queda
-- apuntando a un valor que no está en el catálogo.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, sistema) VALUES
  -- leads.estado — los cinco en uso más los dos que el pipeline del CRM dibuja
  ('estado_lead', 'Nuevo',       'Nuevo',        'slate',   10, true),
  ('estado_lead', 'Contactado',  'Contactado',   'sky',     20, true),
  ('estado_lead', 'Interesado',  'Interesado',   'violet',  30, true),
  ('estado_lead', 'Propuesta',   'Propuesta',    'indigo',  40, true),
  ('estado_lead', 'Negociacion', 'Negociación',  'amber',   50, true),
  ('estado_lead', 'Ganado',      'Ganado',       'emerald', 60, true),
  ('estado_lead', 'Perdido',     'Perdido',      'rose',    70, true),

  -- captaciones.estado_whatsapp — incluye Traspaso, que entró con la 011
  ('estado_whatsapp', 'Pendiente',      'Pendiente',       'slate',   10, true),
  ('estado_whatsapp', 'Enviado',        'Enviado',         'sky',     20, true),
  ('estado_whatsapp', 'Respondido',     'Respondido',      'cyan',    30, true),
  ('estado_whatsapp', 'Interesado',     'Interesado',      'emerald', 40, true),
  ('estado_whatsapp', 'Quiere_Llamada', 'Quiere llamada',  'amber',   50, true),
  ('estado_whatsapp', 'No_Interesado',  'No interesado',   'rose',    60, true),
  ('estado_whatsapp', 'Sin_Telefono',   'Sin teléfono',    'gray',    70, true),
  ('estado_whatsapp', 'Sin_WhatsApp',   'Sin WhatsApp',    'gray',    80, true),
  ('estado_whatsapp', 'Duplicado',      'Duplicado',       'gray',    90, true),
  ('estado_whatsapp', 'Traspaso',       'Traspaso',        'gray',   100, true),

  -- leads.fuente — los tres en uso, más los que escriben workflows que existen
  -- pero todavía no han producido ningún lead
  ('fuente', 'Captaciones',           'Captador Idealista',   'violet',  10, true),
  ('fuente', 'Instagram',             'Instagram',            'pink',    20, true),
  ('fuente', 'Propiedades',           'Ficha de propiedad',   'cyan',    30, true),
  ('fuente', 'Web',                   'Formulario web',       'sky',     40, true),
  ('fuente', 'WhatsApp',              'WhatsApp entrante',    'emerald', 50, true),
  ('fuente', 'QR',                    'Código QR',            'amber',   60, true),
  ('fuente', 'Solicitud valoración',  'Solicitud valoración', 'indigo',  70, true),
  ('fuente', 'Trasteros WhatsApp',    'Trasteros',            'gray',    80, true),

  -- agenda.tipo
  ('tipo_agenda', 'cita',         'Cita',         'violet', 10, true),
  ('tipo_agenda', 'recordatorio', 'Recordatorio', 'amber',  20, true),
  ('tipo_agenda', 'nota',         'Nota',         'cyan',   30, true),

  -- Motivos de pérdida: no existían en ninguna parte. Hoy un lead se cierra
  -- como 'Perdido' sin decir por qué, así que no hay forma de saber si se
  -- pierden por precio o porque nadie los llamó. Son de partida, para editar.
  ('motivo_perdida', 'no_contesta',     'No contesta',              'gray',    10, false),
  ('motivo_perdida', 'precio',          'Precio',                   'amber',   20, false),
  ('motivo_perdida', 'zona',            'Zona no encaja',           'amber',   30, false),
  ('motivo_perdida', 'otra_agencia',    'Se fue con otra agencia',  'rose',    40, false),
  ('motivo_perdida', 'ya_no_busca',     'Ya no busca',              'slate',   50, false),
  ('motivo_perdida', 'financiacion',    'No consigue financiación', 'rose',    60, false),
  ('motivo_perdida', 'fuera_de_perfil', 'Fuera de perfil',          'gray',    70, false),

  -- Etiquetas: ninguna de partida más que estas tres, que son las que se piden
  -- solas. El resto las crea el administrador según le hagan falta.
  ('etiqueta', 'urgente',   'Urgente',    'rose',    10, false),
  ('etiqueta', 'inversor',  'Inversor',   'indigo',  20, false),
  ('etiqueta', 'vip',       'VIP',        'amber',   30, false)
ON CONFLICT (tipo, valor) DO NOTHING;

-- ------------------------------------------------------------
-- 4. La validación se muda del CHECK al catálogo
--
-- El CHECK se quita y en su lugar va un trigger que mira la tabla. Misma
-- protección —no se cuela un estado inventado— pero ahora los valores válidos
-- los decide el administrador y no una migración.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validar_contra_catalogo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo  text := TG_ARGV[0];
  v_campo text := TG_ARGV[1];
  v_valor text;
BEGIN
  EXECUTE format('SELECT ($1).%I::text', v_campo) INTO v_valor USING NEW;

  IF v_valor IS NULL OR v_valor = '' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.catalogos c WHERE c.tipo = v_tipo AND c.valor = v_valor) THEN
    RAISE EXCEPTION '% no es un valor válido de %. Añádelo en Configuración → Catálogos.', v_valor, v_tipo
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- captaciones.estado_whatsapp: se sustituye el CHECK de la 011
ALTER TABLE public.captaciones DROP CONSTRAINT IF EXISTS captaciones_estado_whatsapp_check;
DROP TRIGGER IF EXISTS captaciones_estado_whatsapp_cat ON public.captaciones;
CREATE TRIGGER captaciones_estado_whatsapp_cat
  BEFORE INSERT OR UPDATE OF estado_whatsapp ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_contra_catalogo('estado_whatsapp', 'estado_whatsapp');

-- agenda.tipo
ALTER TABLE public.agenda DROP CONSTRAINT IF EXISTS agenda_tipo_check;
DROP TRIGGER IF EXISTS agenda_tipo_cat ON public.agenda;
CREATE TRIGGER agenda_tipo_cat
  BEFORE INSERT OR UPDATE OF tipo ON public.agenda
  FOR EACH ROW EXECUTE FUNCTION public.validar_contra_catalogo('tipo_agenda', 'tipo');

-- ------------------------------------------------------------
-- 5. leads.estado y leads.fuente: registrar, no rechazar
--
-- Aquí NO se rechaza. Estas dos columnas nunca han tenido CHECK y las escriben
-- siete workflows de n8n y cinco webhooks públicos: poner un trigger que
-- rechace convertiría cualquier valor nuevo en un lead perdido, que es
-- exactamente lo que no se puede permitir.
--
-- En su lugar, un valor desconocido se da de alta solo, desactivado. Así deja
-- de desaparecer en el texto libre: aparece en el panel marcado como nuevo, y
-- el administrador le pone nombre, color y lo activa. Es más seguro que hoy,
-- donde sencillamente no se entera nadie.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_en_catalogo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo  text := TG_ARGV[0];
  v_campo text := TG_ARGV[1];
  v_valor text;
BEGIN
  EXECUTE format('SELECT ($1).%I::text', v_campo) INTO v_valor USING NEW;

  IF v_valor IS NULL OR v_valor = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema)
  VALUES (v_tipo, v_valor, v_valor, 'gray', 900, false, false)
  ON CONFLICT (tipo, valor) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_estado_cat ON public.leads;
CREATE TRIGGER leads_estado_cat
  BEFORE INSERT OR UPDATE OF estado ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.registrar_en_catalogo('estado_lead', 'estado');

DROP TRIGGER IF EXISTS leads_fuente_cat ON public.leads;
CREATE TRIGGER leads_fuente_cat
  BEFORE INSERT OR UPDATE OF fuente ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.registrar_en_catalogo('fuente', 'fuente');

-- ------------------------------------------------------------
-- 6. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   SELECT tipo, count(*) FROM public.catalogos GROUP BY tipo ORDER BY tipo;
--
--   -- Ninguna fila viva debe quedar fuera del catálogo:
--   SELECT DISTINCT l.estado FROM public.leads l
--    WHERE l.estado IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.catalogos c
--                       WHERE c.tipo='estado_lead' AND c.valor=l.estado);
--
--   SELECT DISTINCT c2.estado_whatsapp FROM public.captaciones c2
--    WHERE c2.estado_whatsapp IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.catalogos c
--                       WHERE c.tipo='estado_whatsapp' AND c.valor=c2.estado_whatsapp);
--   -- Las dos deben devolver 0 filas.
