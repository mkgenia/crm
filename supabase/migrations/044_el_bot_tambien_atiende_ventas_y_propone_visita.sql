-- 044 · El bot tambien atiende ventas, y propone visita
--
-- Hasta aqui el bot solo miraba alquileres, y a todo el mundo le hacia el mismo
-- cuestionario. Pero de las demandas que entran, la mayoria son de VENTA: a esa
-- gente no se le pregunta por sus ingresos ni por su situacion laboral —no
-- viene a que le estudien la solvencia, viene a ver un piso—. Lo unico que hay
-- que hacer con ellos es contestarles las dudas y ponerles una visita.
--
-- La visita no se agenda para hoy ni para manana: se propone con al menos 48 h
-- por delante, para que al agente le de tiempo a organizarse.

-- ---------------------------------------------------------------------------
-- La visita propuesta
-- ---------------------------------------------------------------------------
-- Vive en columnas y no en el jsonb de cualificacion porque una visita es un
-- compromiso con una persona y una fecha: tiene que poder consultarse, ordenarse
-- y contarse sin abrir un json.
alter table public.demandas
  add column if not exists visita_propuesta_en timestamptz,
  add column if not exists visita_estado text,
  add column if not exists visita_nota text;

comment on column public.demandas.visita_propuesta_en is
  'El hueco concreto que el bot le ofrecio al cliente.';
comment on column public.demandas.visita_estado is
  'propuesta | aceptada | rechazada | otra_fecha | confirmada. "confirmada" solo lo pone una persona.';
comment on column public.demandas.visita_nota is
  'Lo que dijo el cliente cuando no acepta el hueco tal cual: "mejor por las tardes", "el viernes no puedo"...';

create index if not exists demandas_visitas_aceptadas
  on public.demandas (visita_estado, visita_propuesta_en)
  where visita_estado in ('aceptada', 'otra_fecha');

-- ---------------------------------------------------------------------------
-- El enlace con la agenda
-- ---------------------------------------------------------------------------
-- La agenda ya sabe colgar una entrada de una captacion, un lead o un
-- prospecto. Le faltaba la demanda.
--
-- El bot NO escribe aqui: deja la visita como "aceptada" en la demanda y salta
-- el aviso. Es una persona quien la confirma y quien la mete en la agenda, con
-- su agente. Poner una cita en el calendario de alguien que no la ha visto es
-- la forma mas rapida de que nadie se fie del calendario.
alter table public.agenda
  add column if not exists demanda_id uuid references public.demandas(id) on delete set null;

create index if not exists agenda_por_demanda on public.agenda (demanda_id)
  where demanda_id is not null;

comment on column public.agenda.demanda_id is
  'La demanda de la que sale esta visita, si viene del bot de demandas.';

-- ---------------------------------------------------------------------------
-- El horario en el que se proponen visitas
-- ---------------------------------------------------------------------------
-- Entre semana, manana y tarde. Los sabados solo por la manana. Los domingos no
-- se propone nada: ofrecer una visita en domingo y que luego no haya nadie es
-- peor que ofrecerla para el lunes.
insert into public.app_settings (key, value) values
  ('bot_demandas_visita_horas_minimas', '48'::jsonb),
  ('bot_demandas_visita_huecos', '["10:00","11:30","13:00","17:00","18:30"]'::jsonb),
  ('bot_demandas_visita_huecos_sabado', '["10:00","11:30","13:00"]'::jsonb)
on conflict (key) do nothing;

comment on column public.demandas.bot_estado is
  'pendiente | enviando | contactada | cualificando | cualificada | descartada | atascada | sin_respuesta | fallo_envio | caducada | ensayo | fuera_de_lista | sin_telefono | historico';
