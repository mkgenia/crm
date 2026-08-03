-- ============================================================================
-- VALORADOR · Bajas (detectRemovedListings)
-- Cuando un piso pasa a inactivo, guardamos su último precio como precio_baja
-- y la fecha. Así n8n solo tiene que marcar activo=false.
-- ============================================================================

create or replace function mercado_marcar_baja()
returns trigger as $$
begin
  if NEW.activo = false and OLD.activo = true then
    NEW.precio_baja := coalesce(NEW.precio_baja, OLD.precio);
    NEW.fecha_baja  := coalesce(NEW.fecha_baja, now());
  end if;
  -- Si un piso reaparece (relistado), limpiamos la baja
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
