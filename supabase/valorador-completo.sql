-- ============================================================================
-- VALORADOR DE INMUEBLES — SQL COMPLETO (idempotente, se puede reejecutar)
-- Ejecutar entero en el SQL Editor de Supabase.
-- Incluye: tablas, vista de stats, historial de valoraciones, bajas (trigger)
-- y el historial de cambios de precio.
-- ============================================================================

-- 1) Comparables de mercado scrapeados de Idealista ---------------------------
create table if not exists mercado_inmuebles (
  id                   bigint generated always as identity primary key,
  idealista_id         text unique not null,
  operacion            text default 'venta',            -- 'venta' | 'alquiler'
  tipo                 text,
  codbarrio            text,
  barrio               text,
  lat                  double precision,
  lng                  double precision,
  precio               numeric,
  metros               numeric,
  precio_m2            numeric generated always as (
                         case when metros > 0 then round((precio / metros)::numeric, 2) else null end
                       ) stored,
  habitaciones         int,
  banos                int,
  planta               text,
  ascensor             boolean,
  estado_conservacion  text,
  anunciante           text,                            -- 'agencia' | 'particular'
  agencia_nombre       text,
  activo               boolean default true,            -- false = dado de baja
  fecha_primera_vista  timestamptz default now(),
  fecha_ultima_vista   timestamptz default now(),
  fecha_baja           timestamptz,
  precio_baja          numeric,
  raw                  jsonb
);
create index if not exists idx_mercado_codbarrio on mercado_inmuebles (codbarrio);
create index if not exists idx_mercado_operacion on mercado_inmuebles (operacion);
create index if not exists idx_mercado_activo    on mercado_inmuebles (activo);

-- 2) Vista agregada: €/m² por barrio y operación (mediana + rango + muestra) ---
create or replace view mercado_zonas_stats as
select
  codbarrio,
  operacion,
  count(*)                                                        as muestra,
  round(percentile_cont(0.5)  within group (order by precio_m2))  as precio_m2_mediana,
  round(percentile_cont(0.25) within group (order by precio_m2))  as precio_m2_p25,
  round(percentile_cont(0.75) within group (order by precio_m2))  as precio_m2_p75,
  round(avg(precio_m2))                                           as precio_m2_medio,
  max(fecha_ultima_vista)                                         as actualizado
from mercado_inmuebles
where activo and precio_m2 is not null and codbarrio is not null
group by codbarrio, operacion;

-- 3) Historial de valoraciones hechas en el CRM -------------------------------
create table if not exists valoraciones (
  id              bigint generated always as identity primary key,
  creada_en       timestamptz default now(),
  creada_por      uuid references perfiles(id) on delete set null,
  direccion       text,
  codbarrio       text,
  barrio          text,
  lat             double precision,
  lng             double precision,
  metros          numeric,
  habitaciones    int,
  operacion       text default 'venta',
  precio_m2_zona  numeric,
  valor_estimado  numeric,
  valor_min       numeric,
  valor_max       numeric,
  muestra         int,
  notas           text
);
create index if not exists idx_valoraciones_creada on valoraciones (creada_en desc);

-- 4) Bajas: trigger que rellena precio_baja/fecha_baja al pasar a inactivo -----
create or replace function mercado_marcar_baja()
returns trigger as $$
begin
  if NEW.activo = false and OLD.activo = true then
    NEW.precio_baja := coalesce(NEW.precio_baja, OLD.precio);
    NEW.fecha_baja  := coalesce(NEW.fecha_baja, now());
  end if;
  if NEW.activo = true and OLD.activo = false then
    NEW.fecha_baja  := null;
    NEW.precio_baja := null;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_mercado_baja on mercado_inmuebles;
create trigger trg_mercado_baja
  before update on mercado_inmuebles
  for each row execute function mercado_marcar_baja();

-- 5) Historial de cambios de precio (detectPriceChanges) ----------------------
create table if not exists mercado_precio_historial (
  id              bigint generated always as identity primary key,
  idealista_id    text,
  precio_anterior numeric,
  precio_nuevo    numeric,
  delta           numeric,
  pct             numeric,
  direccion       text,                    -- 'increase' | 'decrease'
  fecha           timestamptz default now()
);
create index if not exists idx_precio_hist_id on mercado_precio_historial (idealista_id);

-- Nota: estas tablas se usan solo desde el servidor (service key). RLS desactivado
-- como el resto del CRM. Si activas RLS, añade políticas.
