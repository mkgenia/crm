-- 041 · El bot de demandas de alquiler
--
-- Las demandas entran solas desde los portales desde hace meses —2.028 en
-- produccion, y siguen cayendo— pero se quedan todas en "Nuevo": nadie las
-- trabaja. El bot que existia era REACTIVO (contestaba a quien escribia); lo
-- que hace falta es el brazo que FALTA en el diagrama: entra la demanda, el bot
-- se pone en contacto y cualifica.
--
-- Esta migracion no toca nada de lo que ya hay: solo anade a `demandas` el
-- rastro del bot, para que el propio workflow sepa a quien ya escribio y en que
-- punto va cada conversacion. El estado de negocio ("Nuevo", etc.) sigue en
-- `estado`, que es de las personas; esto es la maquinaria.

-- ---------------------------------------------------------------------------
-- El estado del bot, por demanda
-- ---------------------------------------------------------------------------
-- Los valores siguen el diagrama, de izquierda a derecha:
--   pendiente    aun no se le ha escrito
--   contactada   primer mensaje enviado, esperando respuesta
--   cualificando conversacion abierta, faltan datos
--   cualificada  los cuatro datos estan y cumple solvencia -> al agente
--   descartada   los datos estan y NO cumple -> cartera general
--   sin_respuesta se le escribio y nunca contesto
--   fuera_de_lista  en pruebas: su telefono no esta en la lista blanca
--   sin_telefono el portal no dio telefono (343 de 2.028 en produccion)
--
-- Sin CHECK a proposito: un valor nuevo no puede tumbar el workflow a las tres
-- de la manana. La lista vive en el comentario y en el codigo del bot.
alter table public.demandas
  add column if not exists bot_estado text not null default 'pendiente',
  add column if not exists bot_contactada_en timestamptz,
  add column if not exists bot_cualificada_en timestamptz,
  add column if not exists bot_intentos smallint not null default 0,
  add column if not exists bot_motivo text;

comment on column public.demandas.bot_estado is
  'pendiente | contactada | cualificando | cualificada | descartada | sin_respuesta | fuera_de_lista | sin_telefono';
comment on column public.demandas.bot_motivo is
  'En texto llano, por que quedo asi. Lo lee una persona, no el codigo.';

-- ---------------------------------------------------------------------------
-- Que no se escriba dos veces a la misma persona
-- ---------------------------------------------------------------------------
-- Idealista manda duplicados: la ref 64-03833 llego dos veces el mismo dia, la
-- misma persona y el mismo piso. Escribir dos veces por WhatsApp a quien no te
-- ha escrito nunca es exactamente la firma que hizo que bloquearan el numero el
-- 10/09/2026. Este indice es la red: si ya hay un contacto para ese telefono y
-- esa propiedad, no hay segundo.
--
-- Parcial, porque solo interesa entre las ya contactadas: dos demandas
-- pendientes de la misma persona son normales mientras no se les escriba.
create unique index if not exists demandas_un_contacto_por_telefono_y_piso
  on public.demandas (telefono, propiedad_id)
  where telefono is not null
    and bot_estado in ('contactada', 'cualificando', 'cualificada', 'descartada');

-- El bot busca "lo pendiente de alquiler con telefono" cada pocos minutos.
create index if not exists demandas_bot_pendientes
  on public.demandas (bot_estado, fecha_creacion)
  where telefono is not null;

-- Para encontrar la conversacion abierta cuando entra un WhatsApp: llega un
-- numero y hay que saber que demanda esta a medias.
create index if not exists demandas_bot_por_telefono
  on public.demandas (telefono, bot_estado)
  where bot_estado in ('contactada', 'cualificando');

-- ---------------------------------------------------------------------------
-- Lo que ya no se puede contactar, marcado de entrada
-- ---------------------------------------------------------------------------
-- 343 de las 2.028 demandas de produccion no traen telefono. Dejarlas en
-- "pendiente" seria mentir: el bot no va a poder hacer nada con ellas nunca, y
-- engordarian la cola para siempre.
update public.demandas
   set bot_estado = 'sin_telefono',
       bot_motivo = 'El portal no facilito telefono'
 where (telefono is null or btrim(telefono) = '')
   and bot_estado = 'pendiente';

-- ---------------------------------------------------------------------------
-- La lista blanca de pruebas
-- ---------------------------------------------------------------------------
-- Mientras se prueba, el bot SOLO puede escribir a los numeros que esten aqui.
-- Vacia la tabla = no escribe a nadie (modo simulacro). Es un freno de mano en
-- la base de datos y no en el codigo, para poder pararlo sin entrar en n8n.
create table if not exists public.bot_demandas_lista_blanca (
  telefono   text primary key,
  quien      text,
  creado_en  timestamptz not null default now()
);

comment on table public.bot_demandas_lista_blanca is
  'Mientras el bot esta en pruebas solo escribe a estos numeros. Vaciarla lo deja mudo.';

insert into public.bot_demandas_lista_blanca (telefono, quien)
values ('+34673298925', 'Josep')
on conflict (telefono) do nothing;

-- Los ajustes del bot, al lado de los del captador.
insert into public.app_settings (key, value)
values
  ('bot_demandas_enabled',      'false'::jsonb),
  ('bot_demandas_lista_blanca', 'true'::jsonb),
  ('bot_demandas_limite_diario', '10'::jsonb)
on conflict (key) do nothing;

-- La instancia de Evolution por la que habla el bot de demandas. NO es la del
-- captador (`demo`, 34613167184): esa es la que bloquearon el 10/09/2026 y ya
-- va cargada con 30 contactos en frio al dia. Las demandas tienen su propio
-- numero, y asi un problema en una no arrastra a la otra.
insert into public.app_settings (key, value)
values ('bot_demandas_instancia', '"Demandas"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- El bot arranca en limpio: solo trabaja lo que entre a partir de AHORA
-- ---------------------------------------------------------------------------
-- En produccion hay 2.028 demandas acumuladas, 1.685 con telefono. Si entraran
-- en la cola, lo primero que haria el bot seria ponerse a escribir a gente que
-- pregunto por un piso hace meses: el piso ya no esta, la persona no se acuerda,
-- y son ~1.700 primeros contactos en frio de golpe por el mismo numero. Es
-- exactamente la receta del bloqueo del 10/09/2026.
--
-- Todo lo anterior queda marcado como historico. Si algun dia se quiere repescar
-- esa cola sera una decision aparte, con su propio ritmo.
update public.demandas
   set bot_estado = 'historico',
       bot_motivo = 'Anterior a la puesta en marcha del bot'
 where bot_estado = 'pendiente';

-- Segundo cinturon, por si alguien vuelve a poner en 'pendiente' una fila vieja:
-- el bot no mira nada creado antes de esta marca.
insert into public.app_settings (key, value)
values ('bot_demandas_desde', to_jsonb(now()::text))
on conflict (key) do nothing;
