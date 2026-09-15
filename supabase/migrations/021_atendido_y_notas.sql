-- ============================================================
-- MIGRACIÓN 021: el botón "Atendido", y las notas como ciudadanas de primera
--
-- POR QUÉ.
-- El panel de una captación pide hoy agente + fecha + hora + recordatorio +
-- estado antes de dejarte apuntar nada. Eso no se rellena nunca, y se nota:
--
--   estado_agenda = 'pendiente' en 735 de 737 captaciones activas
--   notas_agenda escritas a mano ................................ 1
--   motivos de pérdida apuntados sobre 141 leads perdidos ....... 0
--   etiquetas puestas .......................................... 0
--
-- El agente cuelga el teléfono y tiene diez segundos de ganas de apuntar algo.
-- Si le pides un formulario, no apunta nada y se va al cuaderno. Así que:
-- un botón y una caja, y todo lo demás opcional con valor por defecto.
--
-- NO CREA NINGUNA TABLA. Las dos que hacen falta ya existen:
--   · interacciones (018) -> las notas
--   · agenda        (009) -> los recordatorios, que salen solos en /calendario
--
-- QUÉ SE DEJA DE USAR: las cuatro columnas de agenda de `captaciones`
-- (estado_agenda, fecha_agenda, recordatorio_fecha, notas_agenda). Comprobado
-- uno por uno contra los 26 workflows de n8n el 15/09/2026: NINGUNO las lee ni
-- las escribe. `estado_crm` sí la escriben tres, así que ésa no se toca aquí.
-- Las columnas no se borran todavía: primero que la interfaz nueva lleve unos
-- días en pie.
--
-- Se puede ejecutar con el bot mandando WhatsApps: son columnas nullable,
-- índices sobre 881 filas y funciones nuevas. Nada bloquea la tabla.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Catálogo
--
-- Regla de la 012: nada de listas clavadas en código. Los resultados de una
-- llamada son justo lo que cada oficina querrá ajustar a su manera, así que
-- nacen editables desde /configuracion/catalogos.
--
-- Los marcados `sistema` los escribe código y no se pueden borrar; los otros
-- dos son sugerencias que el administrador puede tirar sin romper nada.
-- ------------------------------------------------------------
INSERT INTO public.catalogos (tipo, valor, nombre, color, orden, activo, sistema) VALUES
  ('tipo_interaccion',   'atendido',     'Atendido',           'emerald',  5, true, true),
  ('tipo_interaccion',   'promocion',    'Promoción',          'violet',  65, true, true),

  ('resultado_atencion', 'no_contesta',  'No contesta',        'slate',   10, true, true),
  ('resultado_atencion', 'interesado',   'Le interesa',        'emerald', 20, true, true),
  ('resultado_atencion', 'se_lo_piensa', 'Se lo piensa',       'amber',   30, true, false),
  ('resultado_atencion', 'visita',       'Quedamos en verlo',  'violet',  40, true, false),
  ('resultado_atencion', 'no_interesa',  'No le interesa',     'rose',    50, true, true)
ON CONFLICT (tipo, valor) DO NOTHING;


-- ------------------------------------------------------------
-- 2. El sello de atención
--
-- Es CACHÉ: la verdad vive en `interacciones`. Existe porque la lista de
-- /captaciones consulta la tabla directamente y tiene que poder filtrar "sin
-- atender" y ordenar por "lo que toca antes" sin recorrer las interacciones
-- de cada fila.
--
-- `atendido_en` NO es `ultimo_contacto_en`. Aquélla es el sello del envío del
-- bot y alimenta el tope diario; ésta la escribe una persona al llamar. Que se
-- parezcan tanto es justo el motivo de dejarlo escrito aquí.
-- ------------------------------------------------------------
ALTER TABLE public.captaciones
  ADD COLUMN IF NOT EXISTS atendido_en    timestamptz,
  ADD COLUMN IF NOT EXISTS atendido_por   uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proximo_toque  timestamptz,
  ADD COLUMN IF NOT EXISTS proximo_motivo text;

COMMENT ON COLUMN public.captaciones.atendido_en IS
  'Última vez que una PERSONA la atendió. No confundir con ultimo_contacto_en, que es el sello del envío del bot. Reconstruible desde interacciones.';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS atendido_en    timestamptz,
  ADD COLUMN IF NOT EXISTS atendido_por   uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proximo_toque  timestamptz,
  ADD COLUMN IF NOT EXISTS proximo_motivo text;

-- La cola que el comercial abre por la mañana: lo interesado que nadie ha
-- llamado todavía.
CREATE INDEX IF NOT EXISTS captaciones_sin_atender_idx
  ON public.captaciones (agente_id, ultimo_contacto_en)
  WHERE atendido_en IS NULL AND activo
    AND estado_whatsapp IN ('Interesado', 'Quiere_Llamada');

CREATE INDEX IF NOT EXISTS captaciones_mi_dia_idx
  ON public.captaciones (agente_id, proximo_toque)
  WHERE proximo_toque IS NOT NULL AND activo;

CREATE INDEX IF NOT EXISTS leads_mi_dia_idx
  ON public.leads (proximo_toque) WHERE proximo_toque IS NOT NULL;


-- ------------------------------------------------------------
-- 3. La caché se mantiene sola
--
-- En TRIGGER y no en la acción de servidor porque a `interacciones` también le
-- escribe n8n con apuntar_interaccion(): si esto viviera en TypeScript, una
-- llamada apuntada por un workflow no actualizaría el sello y la lista diría
-- "sin atender" algo que sí se atendió.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_atencion()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Lo automático no cuenta como atender: el bot no ha llamado a nadie.
  IF NEW.automatica OR NEW.tipo NOT IN ('atendido', 'llamada', 'visita') THEN
    RETURN NULL;
  END IF;

  IF NEW.captacion_id IS NOT NULL THEN
    UPDATE public.captaciones
       SET atendido_en  = GREATEST(COALESCE(atendido_en, NEW.ocurrida_en), NEW.ocurrida_en),
           atendido_por = COALESCE(NEW.agente_id, atendido_por)
     WHERE id = NEW.captacion_id;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET atendido_en  = GREATEST(COALESCE(atendido_en, NEW.ocurrida_en), NEW.ocurrida_en),
           atendido_por = COALESCE(NEW.agente_id, atendido_por)
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS interacciones_sincronizar_atencion ON public.interacciones;
CREATE TRIGGER interacciones_sincronizar_atencion
  AFTER INSERT ON public.interacciones
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_atencion();


-- ------------------------------------------------------------
-- 4. Atender: una función, una transacción, un viaje
--
-- La firma ya lleva `p_prospecto_id` aunque esa tabla no exista todavía.
-- Cambiar la lista de parámetros en una migración posterior crearía una
-- SEGUNDA función y las llamadas por nombre quedarían ambiguas ('function is
-- not unique'). Se declara ahora y luego se reemplaza el cuerpo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atender(
  p_agente_id       uuid,
  p_captacion_id    bigint      DEFAULT NULL,
  p_prospecto_id    uuid        DEFAULT NULL,
  p_lead_id         uuid        DEFAULT NULL,
  p_nota            text        DEFAULT NULL,
  p_tipo            text        DEFAULT 'llamada',
  p_resultado       text        DEFAULT NULL,
  p_recordar_en     timestamptz DEFAULT NULL,
  p_recordar_titulo text        DEFAULT NULL,
  p_todo_el_dia     boolean     DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_contacto uuid := p_lead_id;
  v_resumen  text;
  v_inter    uuid;
  v_agenda   uuid;
  v_dueno    uuid;
BEGIN
  IF p_prospecto_id IS NOT NULL THEN
    RAISE EXCEPTION 'Los prospectos todavía no existen: llegan en la 022';
  END IF;
  IF p_captacion_id IS NULL AND p_lead_id IS NULL THEN
    RAISE EXCEPTION 'atender: falta a quién se ha atendido';
  END IF;

  -- La nota cuelga SIEMPRE también de la persona, para que se lea en su ficha
  -- aunque se escribiera desde el anuncio.
  IF v_contacto IS NULL AND p_captacion_id IS NOT NULL THEN
    SELECT COALESCE(l.duplicado_de, l.id) INTO v_contacto
      FROM public.leads l
     WHERE l.captacion_id = p_captacion_id
     ORDER BY l.fecha_creacion ASC
     LIMIT 1;
  END IF;

  -- El resumen se compone solo: al agente no se le pide un título.
  v_resumen := COALESCE(
    NULLIF(left(btrim(regexp_replace(COALESCE(p_nota, ''), '\s+', ' ', 'g')), 120), ''),
    'Atendido');

  INSERT INTO public.interacciones
    (lead_id, captacion_id, tipo, direccion, canal, resumen, detalle,
     agente_id, automatica, ocurrida_en, meta)
  VALUES (v_contacto, p_captacion_id, p_tipo, 'saliente',
          CASE WHEN p_tipo = 'llamada' THEN 'telefono' ELSE 'crm' END,
          v_resumen, NULLIF(btrim(p_nota), ''), p_agente_id, false, now(),
          jsonb_build_object('atendido', true, 'resultado', p_resultado))
  RETURNING id INTO v_inter;

  -- Quien atiende una captación de nadie, se la queda. Sin esto el botón sale
  -- gris justo en las 56 interesadas que esperan sin agente asignado.
  IF p_captacion_id IS NOT NULL THEN
    SELECT agente_id INTO v_dueno FROM public.captaciones WHERE id = p_captacion_id;
    IF v_dueno IS NULL THEN
      UPDATE public.captaciones
         SET agente_id         = p_agente_id,
             asignado_en       = now(),
             asignado_por      = p_agente_id,
             asignacion_motivo = 'Se la quedó al atenderla'
       WHERE id = p_captacion_id AND agente_id IS NULL;
    END IF;
  END IF;

  -- El recordatorio es una fila de `agenda`, así que sale solo en /calendario
  -- sin tocar esa pantalla. Y se titula con la primera línea de la nota:
  -- "quiere que le llame en una semana" se convierte en un recordatorio dentro
  -- de una semana que se llama así. Cero campos extra.
  IF p_recordar_en IS NOT NULL THEN
    INSERT INTO public.agenda
      (titulo, descripcion, tipo, fecha, todo_el_dia, agente_id, creado_por,
       captacion_id, lead_id)
    VALUES (COALESCE(NULLIF(p_recordar_titulo, ''), v_resumen),
            NULLIF(btrim(p_nota), ''), 'recordatorio', p_recordar_en, p_todo_el_dia,
            p_agente_id, p_agente_id, p_captacion_id, v_contacto)
    RETURNING id INTO v_agenda;

    UPDATE public.interacciones
       SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('agenda_id', v_agenda)
     WHERE id = v_inter;

    IF p_captacion_id IS NOT NULL THEN
      UPDATE public.captaciones
         SET proximo_toque = p_recordar_en, proximo_motivo = v_resumen
       WHERE id = p_captacion_id;
    END IF;
    IF v_contacto IS NOT NULL THEN
      UPDATE public.leads
         SET proximo_toque = p_recordar_en, proximo_motivo = v_resumen
       WHERE id = v_contacto;
    END IF;
  END IF;

  RETURN jsonb_build_object('interaccion_id', v_inter,
                            'agenda_id',      v_agenda,
                            'contacto_id',    v_contacto);
END;
$fn$;

COMMENT ON FUNCTION public.atender IS
  'Marca una captación o un lead como atendido por una persona: deja la interacción, opcionalmente el recordatorio en agenda, y se queda la captación si no tenía dueño.';


-- ------------------------------------------------------------
-- 5. Que vaciar la papelera no borre las notas
--
-- `interacciones.captacion_id` es ON DELETE CASCADE (018) y la papelera del CRM
-- hace un DELETE de verdad. Sin esto, vaciar la papelera se lleva por delante
-- los "Atendido" y las notas.
--
-- Y no es un caso raro: es EL CAMINO DE ÉXITO. Se capta el piso, el anuncio
-- desaparece de Idealista, la captación queda inactiva, alguien vacía la
-- papelera — y se borra justo el historial de las que salieron bien.
--
-- No se cambia la clave ajena a SET NULL a propósito: la restricción
-- `interacciones_tiene_dueno` rechazaría la fila huérfana y el DELETE fallaría
-- con un error incomprensible. En su lugar, lo que escribió una persona se
-- repariente al contacto, y el log automático del bot —que es el registro de un
-- anuncio que ya no existe— se va con el anuncio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_borrado_captacion()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_lead uuid;
BEGIN
  SELECT COALESCE(l.duplicado_de, l.id) INTO v_lead
    FROM public.leads l
   WHERE l.captacion_id = OLD.id
   ORDER BY l.fecha_creacion ASC
   LIMIT 1;

  UPDATE public.interacciones
     SET lead_id      = COALESCE(lead_id, v_lead),
         captacion_id = NULL,
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('captacion_borrada', OLD.id)
   WHERE captacion_id = OLD.id
     AND automatica = false
     AND COALESCE(lead_id, v_lead) IS NOT NULL;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS captaciones_proteger_borrado ON public.captaciones;
CREATE TRIGGER captaciones_proteger_borrado
  BEFORE DELETE ON public.captaciones
  FOR EACH ROW EXECUTE FUNCTION public.proteger_borrado_captacion();


-- ------------------------------------------------------------
-- 6. Rescatar lo poco que ya hay escrito
--
-- Medido antes de escribir esto: 1 nota a mano, 3 citas de mayo, 0
-- recordatorios. Casi un no-op — pero esa nota la escribió un agente y se
-- perdería en cuanto la pantalla dejara de enseñarla.
--
-- La guarda compara el CONTENIDO y no sólo la captación, así que se puede
-- volver a ejecutar después de desplegar la interfaz y recoge lo que alguien
-- escribiera en la ventana intermedia.
-- ------------------------------------------------------------
INSERT INTO public.interacciones
  (captacion_id, tipo, direccion, canal, resumen, detalle, agente_id,
   automatica, ocurrida_en, meta)
SELECT c.id, 'nota', 'interna', 'crm',
       left(regexp_replace(btrim(c.notas_agenda), '\s+', ' ', 'g'), 120),
       c.notas_agenda, c.agente_id,
       true,   -- `true` porque no consta QUIÉN la escribió: no se le atribuye a nadie
       COALESCE(c.asignado_en, c.created_at),
       jsonb_build_object('origen', 'captaciones.notas_agenda', 'migracion', '021')
  FROM public.captaciones c
 WHERE NULLIF(btrim(c.notas_agenda), '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.interacciones i
      WHERE i.captacion_id = c.id
        AND i.meta ->> 'origen' = 'captaciones.notas_agenda'
        AND i.detalle IS NOT DISTINCT FROM c.notas_agenda);

-- Las citas que vivían en una columna pasan a ser filas de agenda: así puede
-- haber más de una por captación y salen en /calendario.
INSERT INTO public.agenda
  (titulo, descripcion, tipo, fecha, agente_id, creado_por, captacion_id, lead_id, completado)
SELECT COALESCE('Visita ' || c.calle, 'Visita'), c.notas_agenda, 'cita', c.fecha_agenda,
       c.agente_id, c.agente_id, c.id,
       (SELECT COALESCE(l.duplicado_de, l.id) FROM public.leads l
         WHERE l.captacion_id = c.id ORDER BY l.fecha_creacion LIMIT 1),
       COALESCE(c.estado_agenda, 'pendiente') <> 'pendiente'
  FROM public.captaciones c
 WHERE c.fecha_agenda IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.agenda a
      WHERE a.captacion_id = c.id AND a.fecha = c.fecha_agenda);

INSERT INTO public.agenda
  (titulo, descripcion, tipo, fecha, agente_id, creado_por, captacion_id, lead_id, completado)
SELECT COALESCE('Recordatorio ' || c.calle, 'Recordatorio'), c.notas_agenda,
       'recordatorio', c.recordatorio_fecha, c.agente_id, c.agente_id, c.id,
       (SELECT COALESCE(l.duplicado_de, l.id) FROM public.leads l
         WHERE l.captacion_id = c.id ORDER BY l.fecha_creacion LIMIT 1),
       false
  FROM public.captaciones c
 WHERE c.recordatorio_fecha IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.agenda a
      WHERE a.captacion_id = c.id AND a.fecha = c.recordatorio_fecha);


-- ------------------------------------------------------------
-- 7. Comprobaciones tras ejecutar
-- ------------------------------------------------------------
--   -- Los catálogos nuevos (deben salir 2 tipo_interaccion y 5 resultado):
--   SELECT tipo, count(*) FROM public.catalogos
--    WHERE tipo IN ('tipo_interaccion','resultado_atencion') GROUP BY tipo;
--
--   -- El rescate (1 nota y 3 citas, según lo medido antes de ejecutar):
--   SELECT count(*) FROM public.interacciones WHERE meta->>'migracion' = '021';
--   SELECT count(*) FROM public.agenda WHERE captacion_id IS NOT NULL;
--
--   -- La función, en seco sobre una captación real. Debe devolver los tres ids
--   -- y dejar la fila con atendido_en puesto:
--   --   SELECT public.atender(
--   --     p_agente_id   => (SELECT id FROM public.perfiles LIMIT 1),
--   --     p_captacion_id=> (SELECT id FROM public.captaciones WHERE activo LIMIT 1),
--   --     p_nota        => 'Prueba: quiere que le llame la semana que viene',
--   --     p_resultado   => 'se_lo_piensa',
--   --     p_recordar_en => now() + interval '7 days');
--   --
--   --   SELECT atendido_en, atendido_por, proximo_toque, proximo_motivo
--   --     FROM public.captaciones WHERE id = <la de arriba>;
--   --
--   -- Y para deshacer la prueba:
--   --   DELETE FROM public.agenda WHERE tipo='recordatorio' AND titulo LIKE 'Prueba:%';
--   --   DELETE FROM public.interacciones WHERE resumen LIKE 'Prueba:%';
--   --   UPDATE public.captaciones SET atendido_en=NULL, atendido_por=NULL,
--   --          proximo_toque=NULL, proximo_motivo=NULL WHERE id = <la de arriba>;
