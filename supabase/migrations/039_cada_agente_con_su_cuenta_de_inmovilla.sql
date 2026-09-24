-- ============================================================================
-- 039 · Cada agente del CRM, con su cuenta de Inmovilla
--
-- Para qué. Cuando una captación pasa a prospecto vamos a crear esa ficha en
-- Inmovilla por su API, y ahí hay que decir de quién es: su campo `keyagente`
-- es un número suyo, no un email. Sin esta correspondencia, todos los
-- prospectos subirían a nombre de la misma persona.
--
-- Dos piezas:
--   · `inmovilla_usuarios`, la copia de su lista de usuarios. Su API no permite
--     pedirlos todos de golpe —hay que ir uno a uno con /usuarios/?id=, y los
--     códigos sólo se ven de pasada en los seguimientos—, así que se guardan
--     aquí y se refrescan de vez en cuando. También es lo que alimenta el
--     desplegable al invitar a alguien: sin la copia habría que llamar a su API
--     cada vez que se abre el formulario, y sus topes son bajos.
--   · `perfiles.inmovilla_agente_id`, a quién corresponde cada uno de los
--     nuestros.
--
-- Al final se enlazan los seis que ya tienen cuenta en los dos sitios. Se
-- emparejan POR EMAIL y no a mano: el email es el mismo dato en las dos
-- herramientas, y escribir seis uuid a mano es la forma más fácil de colgarle
-- las captaciones de uno a otro.
-- ============================================================================

-- 1) La copia de sus usuarios ------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inmovilla_usuarios (
  -- Su código, que es lo que viaja en `keyagente`. No se genera aquí.
  id            integer PRIMARY KEY,
  usuario       text,
  nombre        text,
  apellidos     text,
  email         text,
  telefono      text,
  -- Suyo: 1 cuando la cuenta está desactivada en Inmovilla. Se guarda para no
  -- ofrecer en el desplegable a gente que ya no trabaja allí.
  desactivado   boolean NOT NULL DEFAULT false,
  visto_en      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inmovilla_usuarios IS
  'Copia de los usuarios de Inmovilla. La rellena el CRM llamando a GET /usuarios/?id=, que no está en su documentación pero existe; los códigos se descubren en GET /seguimientos/search/.';

CREATE INDEX IF NOT EXISTS inmovilla_usuarios_email_idx
  ON public.inmovilla_usuarios (lower(email));

-- Sólo el servidor la toca. El desplegable de Equipo la lee desde una acción de
-- servidor, que es donde se comprueba que quien pregunta es administrador.
ALTER TABLE public.inmovilla_usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inmovilla_usuarios FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inmovilla_usuarios TO service_role;

-- 2) La columna en perfiles --------------------------------------------------

ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS inmovilla_agente_id integer
    REFERENCES public.inmovilla_usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.perfiles.inmovilla_agente_id IS
  'El `keyagente` de esta persona en Inmovilla. Null = todavía sin enlazar: sus prospectos subirán sin agente hasta que se elija en Equipo.';

-- Una cuenta de Inmovilla no puede estar en dos perfiles a la vez: si lo
-- estuviera, un prospecto podría subir a nombre de quien no lo captó. El índice
-- es parcial porque los null sí se repiten —la mayoría empieza sin enlazar—.
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_inmovilla_agente_uidx
  ON public.perfiles (inmovilla_agente_id)
  WHERE inmovilla_agente_id IS NOT NULL;

-- 3) Los seis que ya existen en los dos sitios -------------------------------
--
-- Leídos de su API el 24/09/2026. Se dan de alta aquí para no depender de que
-- alguien pulse "sincronizar" antes de la primera captación; a partir de ahora
-- la lista la refresca el CRM solo.

INSERT INTO public.inmovilla_usuarios (id, usuario, nombre, apellidos, email) VALUES
  (83109,  'alopez',   'Amparo',  'López',        'alopez@grupohogares.es'),
  (83111,  'aherrero', 'Ana',     'Herrero',      'aherrero@grupohogares.es'),
  (83113,  'cgarcia',  'Cristina','Garcia',       'cgarcia@grupohogares.es'),
  (88278,  'vcruzado', 'Victor',  'Cruzado Tormo','vcruzado@grupohogares.es'),
  (126373, 'pnegre',   'Placido', 'Negre',        'pnegre@grupohogares.es'),
  (189620, 'rvidal',   'Raúl',    'Vidal',        'rvidal@grupohogares.es')
ON CONFLICT (id) DO NOTHING;

-- El enlace, por email. `auth.users` es donde vive el correo de cada perfil.
UPDATE public.perfiles p
   SET inmovilla_agente_id = i.id
  FROM auth.users u, public.inmovilla_usuarios i
 WHERE u.id = p.id
   AND lower(u.email) = lower(i.email)
   AND p.inmovilla_agente_id IS NULL;

-- 4) Comprobación ------------------------------------------------------------
-- Tiene que devolver seis filas, cada perfil con su cuenta.

SELECT p.nombre AS perfil, i.nombre || ' ' || coalesce(i.apellidos, '') AS inmovilla,
       p.inmovilla_agente_id AS codigo
  FROM public.perfiles p
  JOIN public.inmovilla_usuarios i ON i.id = p.inmovilla_agente_id
 ORDER BY p.nombre;
