-- 008 · Permisos por sección
--
-- El menú pasó de 3 secciones a 12 y el admin ahora concede cada una por
-- separado. Los perfiles existentes NO se tocan: la aplicación completa las
-- claves que falten con `resolverPermisos()`, así que nadie pierde acceso a lo
-- que ya usaba. Aquí sólo se actualiza el valor por defecto de la columna, que
-- es lo que reciben las filas creadas directamente en la base de datos.
--
-- Es cosmética: la app escribe siempre el objeto completo al invitar o al
-- cambiar un permiso. Sin ejecutarla, todo sigue funcionando igual.

ALTER TABLE public.perfiles
  ALTER COLUMN permisos
  SET DEFAULT '{
    "captaciones": true,
    "reactivacion": false,
    "galeria_rrss": false,
    "galeria_qr": false,
    "landings": false,
    "leads": true,
    "propiedades": false,
    "prospectos": false,
    "demandas": true,
    "matches": false,
    "mensajes": true,
    "valorador": true
  }'::jsonb;
