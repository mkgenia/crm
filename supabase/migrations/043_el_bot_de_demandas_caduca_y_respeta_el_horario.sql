-- 043 · Las demandas caducan, y el bot respeta un horario
--
-- Dos cosas que salieron al mirar el volumen real de demandas.
--
-- 1. El bot corria LAS 24 HORAS. Un WhatsApp comercial a las cuatro de la
--    manana es una queja segura y, para WhatsApp, una senal mas de que detras
--    hay una maquina. El horario vive en `app_settings` y lo comprueba DEM 02;
--    las RESPUESTAS no pasan por ahi: si alguien escribe de noche, se le
--    contesta.
--
-- 2. Nada CADUCABA. En los tres meses de historico hubo dias de 33 demandas de
--    vivienda: con un tope diario, lo que no cabe espera. Y una demanda
--    contestada tres dias tarde no vale nada —el piso ya se ha ensenado y la
--    persona ni se acuerda de haber preguntado—: escribirle entonces es peor
--    que no escribirle.

insert into public.app_settings (key, value) values
  ('bot_demandas_hora_desde', '10'::jsonb),
  ('bot_demandas_hora_hasta', '21'::jsonb),
  -- Con el ensayo puesto el bot lo hace todo menos enviar: la respuesta que
  -- habria mandado queda en datos_cualificacion.ultima_respuesta. Sirve para
  -- ver como habla con demandas de verdad sin que ningun cliente lo lea.
  ('bot_demandas_modo_ensayo', 'true'::jsonb)
on conflict (key) do nothing;

-- La version de tres parametros se queda ambigua al anadir el cuarto.
drop function if exists public.bot_demandas_mantenimiento(int, int, int);

create or replace function public.bot_demandas_mantenimiento(
  horas_sin_respuesta int default 48,
  minutos_sin_acuse   int default 15,
  intentos_maximos    int default 2,
  horas_caducidad     int default 48
)
returns table (sin_respuesta int, reintentar int, fallidos int, caducadas int)
language plpgsql
security definer
set search_path = public
as $BOT$
declare
  v_sin int := 0; v_reintentar int := 0; v_fallidos int := 0; v_caducadas int := 0;
begin
  -- Lo que salio pero nunca llego: vuelve a la cola.
  with vueltas as (
    update public.demandas
       set bot_estado = 'pendiente', bot_intentos = bot_intentos + 1,
           bot_wa_msg_id = null, bot_contactada_en = null,
           bot_motivo = 'Sin acuse de recibo de WhatsApp: se vuelve a la cola'
     where bot_estado = 'enviando' and bot_entregado_en is null
       and bot_contactada_en < now() - make_interval(mins => minutos_sin_acuse)
       and bot_intentos < intentos_maximos
    returning 1
  ) select count(*) into v_reintentar from vueltas;

  -- Lo que ya se intento demasiadas veces: que lo mire una persona.
  with rendidas as (
    update public.demandas
       set bot_estado = 'fallo_envio',
           bot_motivo = 'No se pudo entregar el mensaje despues de ' || intentos_maximos || ' intentos'
     where bot_estado = 'enviando' and bot_entregado_en is null
       and bot_contactada_en < now() - make_interval(mins => minutos_sin_acuse)
       and bot_intentos >= intentos_maximos
    returning 1
  ) select count(*) into v_fallidos from rendidas;

  -- Lo que llego y nadie contesto. El reloj cuenta desde el ultimo mensaje DE
  -- LA PERSONA si lo hubo, y si no desde que se le escribio.
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

  -- Lo que entro y nunca se le llego a escribir. No se descarta en silencio:
  -- queda marcado para que una persona decida si lo repesca.
  with viejas as (
    update public.demandas
       set bot_estado = 'caducada',
           bot_motivo = 'Entro hace mas de ' || horas_caducidad || ' h y nunca se le llego a escribir'
     where bot_estado = 'pendiente'
       and fecha_creacion < now() - make_interval(hours => horas_caducidad)
    returning 1
  ) select count(*) into v_caducadas from viejas;

  return query select v_sin, v_reintentar, v_fallidos, v_caducadas;
end;
$BOT$;

comment on column public.demandas.bot_estado is
  'pendiente | enviando | contactada | cualificando | cualificada | descartada | atascada | sin_respuesta | fallo_envio | caducada | fuera_de_lista | sin_telefono | historico';
