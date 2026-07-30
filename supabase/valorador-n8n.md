# Valorador — ingesta de datos de mercado (n8n + Apify)

Poblar `mercado_inmuebles` con comparables de Idealista. La valoración solo LEE
de la BD, así que este scrape se ejecuta periódicamente (p.ej. cron semanal),
NO en cada valoración.

## 1) Actor Apify
`memo23/idealista-scraper` (`OTe82JNUGa93aVcRc`).

Input recomendado (Valencia y periferia, venta):

```json
{
  "startUrls": [
    { "url": "https://www.idealista.com/venta-viviendas/valencia-valencia/" }
  ],
  "monitoringMode": true,
  "detectRemovedListings": true,
  "detectPriceChanges": true,
  "maxItems": 10000
}
```

- `monitoringMode` → en runs sucesivos solo devuelve pisos nuevos (barato).
- `detectRemovedListings` → dataset `idealista-removed-<runId>` con los que salieron
  del mercado → marcar `activo=false`, `fecha_baja=now()`, `precio_baja=<último precio>`.
- Repite otro run con la URL de `alquiler-viviendas` para poblar la operación alquiler.

## 2) Asignar cada piso a su barrio (punto-en-polígono)
El actor devuelve `ubication.latitude` / `ubication.longitude`. En un nodo Function
de n8n, con [turf](https://turfjs.org):

```js
const turf = require('@turf/turf');
// Cargar una vez el geojson servido por el CRM:
//   https://<tu-crm>/valencia-barrios.geojson
const barrios = items[0].json.__barrios; // cárgalo con un HTTP Request node y pásalo
const pt = turf.point([lng, lat]);
const hit = barrios.features.find(f => turf.booleanPointInPolygon(pt, f));
const codbarrio = hit?.properties.codbarrio ?? null;
const barrio    = hit?.properties.nombre ?? null;
```

## 3) Mapeo de campos Apify → `mercado_inmuebles`

| Columna Supabase       | Origen en el output del actor                     |
|------------------------|---------------------------------------------------|
| `idealista_id`         | `adid` (o `propertyCode`)                          |
| `operacion`            | `operation` → `'venta'` / `'alquiler'`             |
| `tipo`                 | `propertyType` / `detailedType.typology`           |
| `lat` / `lng`          | `ubication.latitude` / `ubication.longitude`       |
| `codbarrio` / `barrio` | calculado (paso 2)                                 |
| `precio`               | `price`                                            |
| `metros`               | `size` / `moreCharacteristics.constructedArea`     |
| `habitaciones`         | `rooms` / `moreCharacteristics.roomNumber`         |
| `banos`                | `bathrooms` / `moreCharacteristics.bathNumber`     |
| `planta`               | `floor` / `moreCharacteristics.floor`              |
| `ascensor`             | `moreCharacteristics.lift`                          |
| `estado_conservacion`  | `moreCharacteristics.status`                        |
| `anunciante`           | `contactInfo.userType` → `'agencia'`/`'particular'`|
| `agencia_nombre`       | `contactInfo.commercialName`                        |
| `activo`               | `true` (los del dataset principal)                 |
| `raw`                  | el objeto completo (opcional)                       |

`precio_m2` se calcula solo (columna generada).

## 4) Upsert
Insertar con **on conflict (`idealista_id`) do update** para refrescar precio y
`fecha_ultima_vista = now()`. Los `removed` → update a `activo=false`.

## 5) Resultado
La vista `mercado_zonas_stats` recalcula al vuelo la mediana €/m² por barrio, y el
mapa del Valorador se colorea automáticamente. Cero pasos manuales tras el scrape.
