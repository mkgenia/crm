-- ============================================================================
-- VALORADOR DE INMUEBLES — esquema (ejecutar en Supabase SQL Editor)
-- Independiente del pipeline de captaciones.
-- ============================================================================

-- 1) Comparables de mercado scrapeados de Idealista (incluye agencias y bajas)
create table if not exists mercado_inmuebles (
  id                   bigint generated always as identity primary key,
  idealista_id         text unique not null,               -- adid del actor
  operacion            text default 'venta',               -- 'venta' | 'alquiler'
  tipo                 text,                               -- piso, atico, chalet...
  codbarrio            text,                               -- asignado por punto-en-polígono (n8n)
  barrio               text,                               -- nombre legible (opcional)
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
  estado_conservacion  text,                               -- nuevo, buen estado, a reformar...
  anunciante           text,                               -- 'agencia' | 'particular'
  agencia_nombre       text,
  activo               boolean default true,               -- false = dado de baja (fuera de Idealista)
  fecha_primera_vista  timestamptz default now(),
  fecha_ultima_vista   timestamptz default now(),
  fecha_baja           timestamptz,                        -- cuándo desapareció
  precio_baja          numeric,                            -- último precio antes de desaparecer
  raw                  jsonb
);

create index if not exists idx_mercado_codbarrio on mercado_inmuebles (codbarrio);
create index if not exists idx_mercado_operacion on mercado_inmuebles (operacion);
create index if not exists idx_mercado_activo    on mercado_inmuebles (activo);

-- 2) Vista agregada: precio €/m² por barrio y operación (mediana + rango + muestra)
--    La mediana (percentile_cont 0.5) es robusta frente a outliers.
create or replace view mercado_zonas_stats as
select
  codbarrio,
  operacion,
  count(*)                                                          as muestra,
  round(percentile_cont(0.5)  within group (order by precio_m2))    as precio_m2_mediana,
  round(percentile_cont(0.25) within group (order by precio_m2))    as precio_m2_p25,
  round(percentile_cont(0.75) within group (order by precio_m2))    as precio_m2_p75,
  round(avg(precio_m2))                                             as precio_m2_medio,
  max(fecha_ultima_vista)                                           as actualizado
from mercado_inmuebles
where activo and precio_m2 is not null and codbarrio is not null
group by codbarrio, operacion;

-- 3) Historial de valoraciones realizadas en el CRM
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
  operacion       text default 'venta',                    -- 'venta' | 'alquiler'
  precio_m2_zona  numeric,                                 -- mediana €/m² usada
  valor_estimado  numeric,
  valor_min       numeric,
  valor_max       numeric,
  muestra         int,                                     -- nº comparables de la zona
  notas           text
);

create index if not exists idx_valoraciones_creada on valoraciones (creada_en desc);

-- Nota RLS: las server actions usan el service role (createAdminClient), que
-- bypasea RLS. Si quieres exponer estas tablas al cliente directamente, añade
-- políticas explícitas.
