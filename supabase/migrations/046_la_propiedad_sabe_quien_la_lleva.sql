-- 046 · La propiedad sabe quién la lleva
--
-- El bot cerraba todas las conversaciones diciendo "un compañero del equipo te
-- llama". Es verdad, pero suena a centralita. Si la propiedad la lleva Victor,
-- lo que tiene que leer el cliente es que le llama Victor.
--
-- El dato existe y lo estábamos tirando: el XML de Inmovilla que sincroniza
-- `XML 01` cada dos horas trae, en cada propiedad, tres campos con el asesor
-- asignado —nombre_agente, telefono_agente y user_agente—. El parseo los leía y
-- no los escribía.
--
-- Se guardan en la propiedad y no en la demanda porque el asesor es de la
-- propiedad: todas las demandas de la misma referencia comparten asesor, y el
-- día que Inmovilla lo cambie se actualiza en una fila, no en veinte.
--
-- `agente_usuario` es la cuenta de Inmovilla ("vcruzado"), que es lo que permite
-- llegar al perfil del CRM a través de `inmovilla_usuarios.usuario` y
-- `perfiles.inmovilla_agente_id`. Ojo: hoy sólo 6 de las 15 cuentas que salen en
-- el XML están importadas, así que para más de la mitad de las propiedades
-- tenemos el NOMBRE pero no el perfil. Para escribirle al cliente basta con el
-- nombre; para asignar la demanda dentro del CRM hay que sincronizar las cuentas
-- que faltan desde /equipo.
alter table public.propiedades_demanda
  add column if not exists agente_nombre   text,
  add column if not exists agente_telefono text,
  add column if not exists agente_usuario  text;

comment on column public.propiedades_demanda.agente_nombre is
  'El asesor que lleva esta propiedad, según el XML de Inmovilla. Es el nombre que el bot le dice al cliente.';
comment on column public.propiedades_demanda.agente_telefono is
  'Teléfono del asesor en Inmovilla. Puede venir vacío: no todos lo tienen puesto.';
comment on column public.propiedades_demanda.agente_usuario is
  'La cuenta de Inmovilla del asesor ("vcruzado"), para enlazar con inmovilla_usuarios.usuario.';
