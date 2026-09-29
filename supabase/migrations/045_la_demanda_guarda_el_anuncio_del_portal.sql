-- 045 · La demanda guarda el anuncio del portal
--
-- El correo de Idealista trae el codigo del anuncio (112643845), y con el se
-- arma la direccion del inmueble. El capturador lo extraia y lo tiraba: al
-- agente le llegaba el aviso con la referencia interna pero sin forma de abrir
-- el anuncio que la persona estaba mirando cuando escribio.
--
-- Se guarda la DIRECCION hecha y no el codigo suelto porque cada portal la arma
-- distinto: asi el que lo lee solo tiene que pintarlo, y el dia que otro portal
-- empiece a mandar el suyo se cambia en un sitio.
--
-- Fotocasa no manda codigo en el correo. En esos casos se queda vacio: mejor sin
-- enlace que con uno inventado que lleve a un 404.
alter table public.demandas
  add column if not exists anuncio_url text;

comment on column public.demandas.anuncio_url is
  'El anuncio del portal del que sale esta demanda, cuando el correo trae con que armarlo.';
