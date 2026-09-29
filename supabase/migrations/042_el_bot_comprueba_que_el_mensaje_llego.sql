-- 042 · El bot comprueba que el mensaje llego, y cierra lo que no contesta
--
-- Dos agujeros de la primera version, los dos del mismo tipo: el bot daba algo
-- por hecho y nadie se enteraba de lo contrario.
--
-- 1. DABA POR ENVIADO un mensaje porque Evolution le devolvia un identificador.
--    El 28/09/2026 se comprobo que eso NO prueba nada: durante casi un dia
--    Evolution acepto los envios con un 201 y no salio ni uno. Con la logica de
--    entonces, esas demandas habrian quedado marcadas como "contactada" sin que
--    la persona recibiera nada, y nadie les habria vuelto a escribir jamas.
--
-- 2. QUIEN NO CONTESTABA se quedaba en "contactada" para siempre, engordando la
--    lista de conversaciones abiertas sin que nadie lo mirara.

-- ---------------------------------------------------------------------------
-- El rastro del envio
-- ---------------------------------------------------------------------------
alter table public.demandas
  add column if not exists bot_wa_msg_id text,
  add column if not exists bot_entregado_en timestamptz,
  add column if not exists bot_ultimo_mensaje_en timestamptz;

comment on column public.demandas.bot_wa_msg_id is
  'El identificador que da WhatsApp al primer mensaje. Sirve para casar el acuse de recibo con la demanda.';
comment on column public.demandas.bot_entregado_en is
  'Cuando WhatsApp confirmo la ENTREGA. Vacio = salio de aqui pero no consta que llegara.';
comment on column public.demandas.bot_ultimo_mensaje_en is
  'Ultima vez que ESTA PERSONA escribio. Es lo que mide si una conversacion se ha quedado muerta.';

comment on column public.demandas.bot_estado is
  'pendiente | enviando | contactada | cualificando | cualificada | descartada | atascada | sin_respuesta | fallo_envio | fuera_de_lista | sin_telefono | historico';

-- 'enviando' tambien ocupa sitio: mientras se espera el acuse, esa persona ya
-- tiene un mensaje en camino y no puede recibir otro por el mismo inmueble.
drop index if exists demandas_un_contacto_por_telefono_y_piso;
create unique index demandas_un_contacto_por_telefono_y_piso
  on public.demandas (telefono, propiedad_id)
  where telefono is not null
    and bot_estado in ('enviando', 'contactada', 'cualificando', 'cualificada',
                       'descartada', 'atascada', 'sin_respuesta');

-- ---------------------------------------------------------------------------
-- El repaso periodico
-- ---------------------------------------------------------------------------
-- Una sola funcion en vez de cuatro consultas sueltas desde n8n: aqui se lee de
-- corrido lo que hace, y si manana hay que afinar un plazo se cambia un numero.
create or replace function public.bot_demandas_mantenimiento(
  horas_sin_respuesta int default 48,
  minutos_sin_acuse   int default 15,
  intentos_maximos    int default 2
)
returns table (sin_respuesta int, reintentar int, fallidos int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sin int := 0;
  v_reintentar int := 0;
  v_fallidos int := 0;
begin
  -- 1. Lo que salio pero nunca llego. Si pasado el plazo no hay acuse de
  --    recibo, el mensaje no esta entregado: se devuelve a la cola para que el
  --    bot lo intente otra vez, hasta un tope. Es justo lo que no se hacia y lo
  --    que habria perdido gente el 28/09.
  with vueltas as (
    update public.demandas
       set bot_estado = 'pendiente',
           bot_intentos = bot_intentos + 1,
           bot_wa_msg_id = null,
           bot_contactada_en = null,
           bot_motivo = 'Sin acuse de recibo de WhatsApp: se vuelve a la cola'
     where bot_estado = 'enviando'
       and bot_entregado_en is null
       and bot_contactada_en < now() - make_interval(mins => minutos_sin_acuse)
       and bot_intentos < intentos_maximos
    returning 1
  ) select count(*) into v_reintentar from vueltas;

  -- 2. Lo que ya se ha intentado demasiadas veces. No se insiste mas: que lo
  --    mire una persona, porque el problema no es de esa demanda.
  with rendidas as (
    update public.demandas
       set bot_estado = 'fallo_envio',
           bot_motivo = 'No se pudo entregar el mensaje despues de ' || intentos_maximos || ' intentos'
     where bot_estado = 'enviando'
       and bot_entregado_en is null
       and bot_contactada_en < now() - make_interval(mins => minutos_sin_acuse)
       and bot_intentos >= intentos_maximos
    returning 1
  ) select count(*) into v_fallidos from rendidas;

  -- 3. Lo que llego y nadie contesto. El reloj cuenta desde el ultimo mensaje
  --    DE LA PERSONA si lo hubo, y si no desde que se le escribio: asi una
  --    conversacion que se queda a medias tambien se cierra sola.
  with calladas as (
    update public.demandas
       set bot_estado = 'sin_respuesta',
           bot_motivo = case
             when bot_ultimo_mensaje_en is null
               then 'No contesto al primer mensaje en ' || horas_sin_respuesta || ' h'
             else 'Dejo la conversacion a medias hace mas de ' || horas_sin_respuesta || ' h'
           end
     where bot_estado in ('contactada', 'cualificando')
       and coalesce(bot_ultimo_mensaje_en, bot_contactada_en)
           < now() - make_interval(hours => horas_sin_respuesta)
    returning 1
  ) select count(*) into v_sin from calladas;

  return query select v_sin, v_reintentar, v_fallidos;
end;
$$;

comment on function public.bot_demandas_mantenimiento is
  'Repaso del bot de demandas: reintenta lo que no consta entregado, se rinde tras N intentos, y cierra como sin_respuesta lo que lleva 48 h callado.';
