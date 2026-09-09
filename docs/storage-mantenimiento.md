# Supabase Storage — auditoría y mantenimiento

## El problema (detectado ago 2026)

El bucket `captaciones` estaba **al 122% del plan free** (1,2 GB de 1 GB):

| Causa | Impacto |
|---|---|
| **1.154 carpetas huérfanas** (64%) — pisos borrados de la BD cuyas imágenes seguían en Storage | 788 MB |
| **15,4 imágenes por piso** de media, cuando el CRM sólo usa 1-2 | 366 MB |

Las carpetas se llaman igual que `captaciones.id` (= `adid` de Idealista), así que
una carpeta cuyo id no está en la tabla es basura por definición.

## La limpieza ejecutada

| Fase | Acción | Liberado |
|---|---|---|
| 1 | Borradas 1.154 carpetas huérfanas (17.511 archivos) | **788 MB** |
| 2 | Recortado a 5 imágenes/piso en 598 pisos (7.830 archivos) | **366 MB** |
| 3 | `captaciones.imagenes` recortado a 5 URLs en 597 filas (evita imágenes rotas) | — |

**Resultado: 1.224 MB → 133 MB** · 647 carpetas · 5,0 imgs/piso · 210 KB/piso.

## 🐛 La causa raíz (encontrada ago 2026)

`eliminarDefinitivamente` **sí llamaba** a `storage.remove()`, pero usaba
`createAdminClient`, que **arrastra las cookies de sesión**: con `@supabase/ssr` ese
JWT manda sobre la service key, así que la petición se ejecuta como *usuario
autenticado* y las políticas del bucket la bloquean.

Y lo peor: **Storage no devuelve error**. Comprobado con una prueba real:

| Credencial | Respuesta | ¿Borra? |
|---|---|---|
| anon / usuario | **HTTP 200** con `[]` | ❌ NO |
| service_role puro | HTTP 200 con la lista | ✅ SÍ |

Como respondía 200 sin error, el `Promise.allSettled` lo daba por bueno → las
carpetas quedaban huérfanas **en silencio**. Es el mismo bug que provocó que los
comparables del valorador salieran vacíos por RLS.

## Prevención aplicada

- **`createServiceClient()`** nuevo en `lib/supabase/server.ts`: cliente
  `service_role` **sin cookies**, para operaciones administrativas reales.
  Usarlo SIEMPRE para Storage y para saltarse RLS de verdad.
- **`eliminarDefinitivamente`**: usa ese cliente, ya no silencia errores
  (los registra en consola) y **detecta el 200-con-lista-vacía** como fallo.
- **`archivarImagenes`** (valorador): mismo cambio.
- **`Auto-Contacto (Venta/Alquiler).json`**: el nodo *Extraer Fotos* limita a
  `MAX_FOTOS = 5`. Antes subía todas las de Idealista (hasta 16+).

## Mantenimiento periódico (recomendado: trimestral)

Scripts en el scratchpad de la sesión (o recrear con esta lógica):

1. **Detectar huérfanas**: listar carpetas del bucket (paginando de 1.000 en 1.000)
   y cruzar con `select id from captaciones`. Lo que no esté → basura.
2. **Borrar**: `DELETE /storage/v1/object/captaciones` con `{"prefixes": [...]}`
   en lotes de ~300 rutas.
3. **Recortar**: por cada carpeta con más de 5 archivos, borrar de la 6ª en adelante
   (ordenando por el número de `img_N.webp`).
4. **Sincronizar BD**: recortar `captaciones.imagenes` a las mismas 5 y arreglar
   `imagen_url` si apuntaba a una borrada.

> ⚠️ Siempre verificar antes de borrar que **todas** las carpetas candidatas son
> numéricas (ids de captación) y que no hay carpetas de otras funciones
> (p. ej. `mercado/` del valorador).

## Ojo con el valorador

El workflow del valorador archiva imágenes en `captaciones/mercado/<idealista_id>.jpg`
(máx. 150 por run) porque las URLs de Idealista caducan en ~24 h. Con un run semanal
son ~7,5 MB/semana (~390 MB/año). **Incluir `mercado/` en la limpieza periódica**:
borrar las que no estén referenciadas en `mercado_inmuebles` ni en
`valoraciones.comparables`.
