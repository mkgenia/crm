-- 047 · La demanda nace con asesor
--
-- Una demanda no tenia dueño: ni campo habia. El bot ya dice "Cristina se
-- pondra en contacto contigo" —el nombre sale del XML de Inmovilla—, pero dentro
-- del CRM esa demanda no era de nadie, asi que nadie la veia como suya. El
-- 05/10/2026 habia 19 esperando a que alguien las cuadrase, 14 de ellas de
-- Cristina, la mas antigua con 95 horas.
--
-- El dato ya estaba y la cadena estaba completa; solo faltaba el ultimo paso:
--
--   propiedades_demanda.agente_usuario -> inmovilla_usuarios.usuario
--                                      -> perfiles.inmovilla_agente_id
--
-- SOLO LOS ASESORES DE LA OFICINA. `inmovilla_usuarios` son las seis cuentas que
-- estan en el CRM. Las propiedades que lleva otra oficina —algo mas de la mitad—
-- se quedan SIN ASIGNAR a proposito: esas visitas las trabaja la oficina, y es
-- mejor una bandeja que coge quien va a atenderla que un dueño inventado.
--
-- Va en la base y no en el capturador para que valga venga de donde venga la
-- demanda: del correo, del CRM o metida a mano.

alter table public.demandas
  add column if not exists agente_id uuid references public.perfiles(id) on delete set null;

create index if not exists demandas_agente_idx on public.demandas (agente_id);

comment on column public.demandas.agente_id is
  'El asesor que lleva la propiedad, resuelto desde el XML de Inmovilla. Null si la lleva otra oficina.';


-- Quien lleva una propiedad, si es de los nuestros.
create or replace function public.asesor_de_la_propiedad(p_propiedad uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pe.id
    from public.propiedades_demanda p
    join public.inmovilla_usuarios iu
      on lower(iu.usuario) = lower(p.agente_usuario)
     and coalesce(iu.desactivado, false) = false
    join public.perfiles pe
      on pe.inmovilla_agente_id = iu.id
   where p.id = p_propiedad
   limit 1;
$$;


-- Al crear una demanda se le pone dueño, salvo que ya venga con uno.
create or replace function public.demanda_pone_asesor()
returns trigger
language plpgsql
security definer
set search_path = public
as $BOT$
begin
  if new.agente_id is null and new.propiedad_id is not null then
    new.agente_id := public.asesor_de_la_propiedad(new.propiedad_id);
  end if;
  return new;
end;
$BOT$;

drop trigger if exists demandas_pone_asesor on public.demandas;
create trigger demandas_pone_asesor
  before insert on public.demandas
  for each row execute function public.demanda_pone_asesor();


-- EL HUECO DE LAS PROPIEDADES NUEVAS.
--
-- El capturador crea la propiedad desde el correo del portal, que no trae
-- asesor; quien lo rellena es `XML 01`, cada dos horas. Asi que las primeras
-- demandas de una propiedad recien aparecida nacerian huerfanas. Cuando XML 01
-- le pone el asesor, se reparten tambien sus demandas sin dueño.
create or replace function public.propiedad_reparte_sus_demandas()
returns trigger
language plpgsql
security definer
set search_path = public
as $BOT$
declare
  v_asesor uuid;
begin
  if new.agente_usuario is distinct from old.agente_usuario then
    v_asesor := public.asesor_de_la_propiedad(new.id);
    if v_asesor is not null then
      update public.demandas
         set agente_id = v_asesor
       where propiedad_id = new.id
         and agente_id is null;
    end if;
  end if;
  return new;
end;
$BOT$;

drop trigger if exists propiedades_reparten_demandas on public.propiedades_demanda;
create trigger propiedades_reparten_demandas
  after update of agente_usuario on public.propiedades_demanda
  for each row execute function public.propiedad_reparte_sus_demandas();


-- Las que ya estaban. Se puede repetir sin miedo: solo toca las que no tienen
-- dueño, nunca reasigna una que alguien haya cambiado a mano.
update public.demandas d
   set agente_id = public.asesor_de_la_propiedad(d.propiedad_id)
 where d.agente_id is null
   and d.propiedad_id is not null
   and public.asesor_de_la_propiedad(d.propiedad_id) is not null;


-- Cómo queda.
select
  count(*) filter (where agente_id is not null) as con_asesor,
  count(*) filter (where agente_id is null)     as sin_asignar,
  count(*)                                       as total
from public.demandas;
