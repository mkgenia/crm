# Valorador de inmuebles — documentación

Referencia de todas las piezas del valorador: qué hace cada una, cómo encajan
entre sí, y qué vamos a añadir. Objetivo: que nada se solape ni haya que
replicar cosas.

---

## 1. Visión general (el flujo en una frase)

**El captador (n8n + Apify)** pasa todo lo que descarga a **VAL 02**, que llena una
tabla de pisos → **una vista** calcula el precio medio €/m² por barrio → **el mapa**
lo pinta → **al valorar**, se coge la zona + características del piso y se sacan
**tres precios** (verde/amarillo/rojo).

```
Idealista ──(Apify)──> CAP 01 (captador, cada 30 min)
                                         │ webhook: todo lo que descarga
                                         ▼
              VAL 02 (n8n) ──> Supabase: mercado_inmuebles
                                         │
                                         ├─> vista mercado_zonas_stats (€/m² por barrio)
                                         │           │
                                         │           ▼
                                         │      Mapa (coropletas)
                                         └─> comparables ──> Motor 3 bandas ──> valoraciones (historial)
```

VAL 01, el scraper propio del valorador, está **desactivado** desde el 17/09/2026 hasta
rehacerlo como escaneo completo de los domingos (punto 4).

---

## 2. Capa de datos (Supabase)

SQL en [`supabase/valorador.sql`](../supabase/valorador.sql).

### Tabla `mercado_inmuebles` — la materia prima
Un registro por piso scrapeado de Idealista (activos, agencias y particulares).
Campos clave: `idealista_id` (único), `codbarrio`, `precio`, `metros`,
`precio_m2` (columna **generada** = precio/metros), `habitaciones`, `banos`,
`planta`, `ascensor`, `estado_conservacion`, `anunciante`, `activo`,
`fecha_baja`, `precio_baja`. Desde la migración 038, también `descripcion`,
`num_fotos`, `faltas_escaneo` y `ultimo_escaneo`. **De aquí sale todo.**
A 17/09/2026: 3.661 filas, 2.961 activas.

### Qué cambió y si sigue publicado — migración 038
[`038_el_mercado_recuerda_que_cambio.sql`](../supabase/migrations/038_el_mercado_recuerda_que_cambio.sql),
ejecutada el 17/09/2026 con las 16 comprobaciones en ok. Pruebas en
[`supabase/pruebas/038_pruebas_mercado.sql`](../supabase/pruebas/038_pruebas_mercado.sql).

- **El historial ya no es solo de precio.** `mercado_precio_historial` gana `campo`,
  `valor_anterior` y `valor_nuevo` (las 228 filas antiguas quedan como `precio`). Lo
  escribe el trigger `trg_mercado_registrar_cambios` (AFTER UPDATE), venga el cambio
  de donde venga: precio, publicado, descripción, nº de fotos, metros, habitaciones,
  baños, planta, ascensor, estado, extras, gastos, obra nueva, tipo detallado,
  anunciante y agencia. No apunta el paso de null a un valor ni al revés.
- **Lo viejo no pisa lo nuevo.** `trg_mercado_a_no_pisar` (BEFORE UPDATE) ignora una
  captura más antigua que la guardada, y si un campo llega vacío se queda el valor
  que había (el formato corto de Idealista no trae terraza, aire ni parking).
- **Publicado o de baja: una sola regla**, la RPC `mercado_aplicar_escaneo(p_vistos,
  p_inicio, p_total)`. Nada más marca bajas. Se niega si el escaneo no llega al 97%
  del total o si ya se aplicó; da de baja solo tras **dos** escaneos completos
  seguidos sin ver el anuncio, y reactiva las bajas falsas que vuelve a ver. Solo la
  puede llamar `service_role` (n8n).

Tras el backfill del 17/09 (punto 4) el historial tiene 228 filas de precio y 1
`publicado` de no a sí: una baja falsa reactivada.

### Vista `mercado_zonas_stats` — el resumen por barrio
No guarda datos: es una consulta automática que agrupa `mercado_inmuebles` y
calcula por `codbarrio` + `operacion` la **mediana €/m²**, P25, P75 y la muestra.
Es lo que **colorea el mapa**. Se recalcula sola.
> ⚠️ Es una **vista**: se saltaba el RLS de la tabla base. Por eso el mapa
> funcionaba aunque la tabla tuviera RLS. (Ver punto 8.) Desde la migración 036 va
> con `security_invoker`: respeta el RLS de quien pregunta.

### Informe PDF descargable (2 hojas A4)
En `/valorador/informe/[id]` ([`informe-valoracion.tsx`](../src/components/valorador/informe-valoracion.tsx)).
Acceso: icono de documento en el panel **Historial**. Botón **Descargar PDF** →
`window.print()` → "Guardar como PDF". Sin dependencias, calidad vectorial.

- **Hoja 1**: logo + ref. `VAL-00012`, datos del inmueble, las tres bandas
  (precio de venta destacado), características consideradas, metodología y aviso
  legal (no es tasación ECO/805/2003).
- **Hoja 2**: **testigos comparables como cards con foto, 4 por fila** (máx. 16 =
  4×4, encaja en una A4 con holgura). Cada card: imagen, nº, % de semejanza,
  precio, €/m², m²/hab/baños/planta, zona, estado + letra energética y
  equipamiento. Los vendidos salen en gris con sello "VENDIDO". Debajo, resumen
  estadístico (mín/mediana/media/máx) y la fuente.

**Formato de impresión**: A4 (210×297 mm) con márgenes de 18 mm, `@page { size: A4 }`,
pie anclado abajo (`margin-top:auto`), salto de página entre hojas y
`break-inside: avoid` en las cards para que no se partan. El CSS vive en
`globals.css` (con styled-jsx, Turbopack rompía la página).

**Imágenes — importante**: las URLs de Idealista van **firmadas y caducan en ~24 h**
(sin firma → 403; no existe URL permanente). Por eso se archivan en Supabase Storage
(`captaciones/mercado/<idealista_id>.jpg`) en dos puntos:
1. **En el workflow**: lo hacía VAL 01 (nodos `Preparar Imagenes → Descargar Imagen →
   Subir a Storage → Fijar URL Permanente`, máx. 150 por run). **VAL 02 no archiva
   fotos**: guarda la URL firmada de Idealista. Leído el 17/09/2026, ninguna de las
   3.661 filas apunta a Storage.
2. **Al guardar una valoración** (`archivarImagenes` en las server actions): hoy es
   la única vía. Si la URL ya ha caducado, el testigo se queda sin foto.
Si una foto no está disponible, el testigo se muestra en la **lista compacta** en
lugar de como card — las dos vistas conviven en la misma hoja.

> Los comparables se guardan como **snapshot congelado** en `valoraciones.comparables`
> (jsonb, máx. 20). Así el informe no cambia aunque el mercado sí. Requiere la
> columna del SQL: `alter table valoraciones add column if not exists comparables jsonb;`

### Tabla `valoraciones` — el historial
Cada valoración guardada desde el CRM: dirección, `codbarrio`, `metros`,
`operacion`, las tres bandas (`valor_min`=verde, `valor_estimado`=amarillo,
`valor_max`=rojo), `muestra` y `notas` (resumen de características).

### Nota RLS
Las 3 tablas se usan **solo desde el servidor**. Desde la migración 036 tienen RLS
con una política para `authenticated` (el CRM) y n8n escribe como `service_role`,
que se lo salta. Comprobado el 17/09/2026: con la clave pública, las tres tablas y
la vista devuelven 0 filas.

---

## 3. Asset estático: `public/valencia-barrios.geojson`

Los **88 barrios oficiales** de Valencia (polígonos + `codbarrio` único + nombre).
Fuente: geoportal del Ayuntamiento. Dos usos:
1. **El navegador** lo carga para dibujar el mapa.
2. **n8n** lo descarga para asignar a cada piso su barrio por punto-en-polígono.

> Se sirve desde el CRM. El middleware está configurado para **no** pedir login
> en `.geojson` (ver punto 8). Si el CRM no está desplegado, esa URL da 404.

---

## 4. Ingesta de datos (n8n + Apify)

Desde el 17/09/2026 el mercado entra **por el captador**:

```
CAP 01 (cada 30 min) ─> Apify Scrapear Zonas ─> Recortar para Mercado ─> Enviar a Mercado
                                                                               │
          ┌────────────────── POST /webhook/mercado-ingesta ───────────────────┘
          ▼
VAL 02:   Webhook ─> Fetch Barrios ─> Barrio + Mapeo ─> Supabase Upsert ─> mercado_inmuebles
```
- **CAP 01** manda **todos** los anuncios de cada pasada, agencias incluidas, por
  una rama aparte. `Recortar para Mercado` quita campos pesados, teléfonos y el nombre
  de los particulares. `Enviar a Mercado` sigue aunque falle: nunca para las
  captaciones. Coste extra en Apify: cero, los anuncios ya estaban pagados.
- **VAL 02** (`QPAX_a58nMcQJiah9xTI4`, activo) es el antiguo `VAL 02 · Snapshot 1000`
  (solo corrió una vez, el 04/08) reconvertido. Webhook con credencial `n8n Interno`,
  geojson con 3 reintentos, upsert `on_conflict=idealista_id` + `merge-duplicates`
  con credencial de n8n, sin claves en el JSON. Copia en el repo:
  [`n8n/6-valorador-guardar-en-mercado.json`](../n8n/6-valorador-guardar-en-mercado.json).
- **Supabase Upsert** no duplica y actualiza con cada captura, pero con las reglas de
  la 038 (punto 2): una captura vieja no pisa una nueva y un campo vacío no borra.

### Por qué por el captador: la memoria de `monitoringMode` es de la cuenta
Captador y valorador usan el mismo actor, `memo23/idealista-scraper`. Con
`monitoringMode` la memoria de "ya visto" es **una por cuenta de Apify**, no por
workflow ni por URL: cada anuncio se entrega una sola vez, al primer run que lo ve.
El captador pasa cada 30 min, así que se quedaba las novedades y tiraba las de
agencia (~90%): de 3.393 anuncios que vio desde el 08/09, solo 2 estaban en
`mercado_inmuebles`.

> ⚠️ **`monitoringMode` no refresca filas** (aquí se decía lo contrario). Un anuncio
> ya visto por la cuenta no se vuelve a entregar; como mucho llegan su cambio de
> precio (`detectPriceChanges`) o su baja (`detectRemovedListings`). Un piso que
> sigue igual no actualiza nada por esa vía. Lo que confirmará que sigue publicado
> es el escaneo de los domingos (`mercado_aplicar_escaneo`), cuando VAL 01 esté rehecho.

### Ámbito: solo venta de pisos
Decisión de Josep: "solo venta de pisos de momento". VAL 02 guarda solo `operation`
sale + `propertyType` homes + nivel 2 `València`. Quedan fuera las pedanías a las que
Idealista da nivel 2 propio (El Saler, El Perellonet, Pinedo…) y el área
metropolitana. Para ampliarlo, ver pendientes (punto 10).

### Mapeo (`Barrio + Mapeo`, arreglado el 17/09/2026)
- `codbarrio` por punto-en-polígono (lat/lng vs geojson); si cae fuera, por nombre,
  quitando el prefijo `Subdistrict`/`District` y con una tabla corta de alias
  (`El Cabanyal-El Canyamelar`, `Playa de la Malvarrosa`…).
- `planta` salía **siempre null**: ahora `moreCharacteristics.floor`.
- `obra_nueva` también: ahora `basicInfo.newDevelopment` o, si no viene, el `status`.
- `imagen_url` con respaldo cuando falta la primera foto.
- Columnas nuevas `descripcion` y `num_fotos`.
- `caracteristicas.ocupacion`: alquilado, okupado o nuda propiedad (`tenanted`,
  `illegallyOccupied`, `bareOwnership`). Se venden con descuento y ensucian la mediana.

### Rescate y backfill (17/09/2026)
Antes de que la retención de 14 días de n8n las borrara, se guardaron en local 3.925
capturas del captador (3.544 anuncios distintos, del 08/09 al 17/09). Las 2.307 de
venta de vivienda pasaron por VAL 02: la captura más nueva de cada anuncio, de la más
vieja a la más nueva. `mercado_inmuebles` pasó de 2.156 a 3.661 filas (+1.505) y las
activas de 1.455 a 2.961. Quedan 8 barrios con menos de 10 muestras en las stats.

### VAL 01 (`Q46j_xisv84jITwD5sWhO`): desactivado
**Cómo estaba**: los lunes, `maxItems` 500 de los ~5.420 anuncios de venta de
València, en orden de relevancia. "Retirado" quería decir "ha salido de la ventana":
de las 701 bajas, al menos 105 son falsas probadas. Falló 3 de los últimos 6 lunes
(uno con un 403 por el token de Apify escrito en el workflow), 1.207 de las 1.455
activas llevaban más de 30 días sin verse, y `planta` y `obra_nueva` llegaban siempre
null.

**Desactivado el 17/09/2026** (el lunes 21/09 no corre). **Pendiente, antes del
domingo 11/10**: rehacerlo como **escaneo completo de los domingos** de
`venta-viviendas/valencia-valencia` (`monitoringMode` + `detectPriceChanges` +
`detectRemovedListings`, `maxItems` 6000), con el mapeo de VAL 02, **sin** los nodos
`Insert Historial` (el trigger de la 038 ya apunta el cambio: con los dos saldría
doble) ni `Supabase Bajas`, y llamando a `mercado_aplicar_escaneo` con todos los ids
recorridos, no solo los nuevos.

Así era (modo asíncrono, para esquivar el timeout de los runs largos):
```
Cron ─> Config ─> Fetch Barrios ─> Start Run ─> Get Status ─┐
                                        ▲                     │
                                        └── Esperar 25s ◄── ¿Terminado? (no)
                                                              │ (sí)
                                                      Get Items ─> Barrio+Mapeo ─> Supabase Upsert
```

---

## 5. Server actions — [`src/lib/actions/valorador.ts`](../src/lib/actions/valorador.ts)

Casi todas usan el cliente admin (`createAdminClient`, que lleva la cookie de sesión:
habla como `authenticated`); `crearValoracion` usa `createClient` y `archivarImagenes`,
`createServiceClient` (Storage pide `service_role` puro). Puente entre la UI y Supabase.

| Función | Qué hace |
|---|---|
| `getZonasStats(operacion)` | Lee la vista → stats €/m² por barrio. **Colorea el mapa.** |
| `getComparablesBarrio(codbarrio, operacion)` | Pisos individuales de un barrio. **Panel de comparables.** |
| `getComparablesRadio(lat, lng, radioMetros, operacion)` | Pisos dentro del círculo de valoración (punto 7). |
| `getValoraciones()` | Lista el historial. |
| `crearValoracion(input)` | Guarda una valoración (las 3 bandas). |
| `eliminarValoracion(id)` | Borra del historial. |
| `getFactoresMercado(operacion)` | Calcula coeficientes **con datos reales** (hoy: factor ascensor con/sin). |

> **Tope de 1.000 filas.** PostgREST corta en 1.000 filas sin avisar. El factor
> ascensor salía de 1.000 de las 1.455 activas, y a 2,5 km del Ayuntamiento el radio
> perdía 481 de 1.481 comparables. Arreglado con `traerTodo`
> ([`src/lib/supabase/paginar.ts`](../src/lib/supabase/paginar.ts)) en
> `getFactoresMercado`, `getComparablesBarrio`, `getComparablesRadio` y
> `attachCambios` (ids de 150 en 150; se salta las filas del historial que no son de
> precio). tsc y eslint limpios. **Falta desplegar** para que llegue a producción.

---

## 6. Interfaz — componentes

| Archivo | Rol |
|---|---|
| [`app/(dashboard)/valorador/page.tsx`](<../src/app/(dashboard)/valorador/page.tsx>) | Server component: carga stats + valoraciones + factores y los pasa al shell. |
| [`components/valorador/valorador-shell.tsx`](../src/components/valorador/valorador-shell.tsx) | Orquestador: cabecera, toggle venta/alquiler, mapa y **paneles laterales** (estilo Leads). Guarda el estado (zona seleccionada, comparables, exclusiones). |
| [`components/valorador/valorador-map.tsx`](../src/components/valorador/valorador-map.tsx) | Mapa Leaflet de coropletas (color por €/m²). Se carga con `dynamic ssr:false`. |

**Paneles** (dentro del shell, se abren al lado del mapa):
- **Comparables**: lista los pisos del barrio; puedes **excluir** los que no representen → las stats se recalculan en vivo.
- **Nueva valoración**: inputs + motor de 3 bandas (ver punto 7).
- **Historial**: valoraciones guardadas.

---

## 7. El motor de valoración (3 bandas)

En el panel **Nueva valoración**. Fórmula:

```
banda = m² × (€/m² de la zona) × (factor de características)
```

- **€/m² de la zona**: P25 (verde), mediana (amarillo), P75 (rojo) — del conjunto
  de comparables, que puedes **editar** (excluir outliers) → recalcula al vuelo.
- **Factor de características** (multiplicador):
  - **Ascensor** → **con datos reales** (`getFactoresMercado`: ratio con/sin).
  - **Condición, planta, extras** (AC, parking, trastero, terraza, piscina) →
    **heurísticos**, con el % visible. La UI avisa de que son estimación.

**Salida:**
- 🟢 Verde = venta rápida (≈ P25)
- 🟡 Amarillo = valor estimado (mediana)
- 🔴 Rojo = ambicioso (≈ P75)

**Comparables editables**: al excluir pisos, cambian P25/mediana/P75 → cambian
las 3 bandas. La muestra usada se guarda con la valoración.

### Comparación por RADIO (estilo BetterPlace) — mecánica única
Valorar = **fijar un punto + ajustar un radio**. Una sola forma, sin mezclar:
- **Fijar el punto**: escribir una dirección (geocode) **o hacer clic en el mapa**
  (en modo valoración, el clic coloca el punto en vez de seleccionar barrio).
- **Radio ajustable** (slider 200 m–2,5 km) → comparables = pisos **dentro del
  círculo** (`getComparablesRadio`, filtro haversine).
- **Los comparables se ven como puntos en el mapa**, coloreados por €/m². Click en
  un punto → lo excluye/incluye y recalcula las bandas en vivo.
- El **heatmap de barrios se mantiene** como contexto (el círculo va encima).
- El **click en barrio** (fuera de valoración) sigue mostrando su ficha de precio
  para explorar; "Valorar aquí" cae el punto en el centro del barrio.

### Descuento de venta real (−15%)
Toggle (por defecto **activado**): los pisos suelen venderse ~15% por debajo del
precio de anuncio de Idealista. Aplica ×0.85 a las **tres bandas**. El usuario
puede desactivarlo. Se registra en las notas de la valoración.

---

## 8. Detalles que costó depurar (para no repetirlos)

- **RLS**: `mercado_inmuebles` respetaba RLS y devolvía vacío en comparables
  (la vista no, por eso el mapa sí iba). Solución de entonces: RLS desactivado en
  las tablas. Desde la 036 vuelve a estar activo, con política para `authenticated`
  (punto 2, Nota RLS). Si el mapa se queda en blanco, mirar ahí primero.
- **Middleware**: `crm.mkgenia.com/valencia-barrios.geojson` redirigía a `/login`
  → n8n no bajaba el geojson → pisos sin barrio. Solución: el matcher de
  [`middleware.ts`](../src/middleware.ts) excluye `.geojson/.json/.xml/.txt`.
- **codbarrio duplicado**: dos barrios compartían el código `175` en los datos
  oficiales → clave repetida en React. Se hizo único (`175` y `175-2`).
- **Timeout del scraper**: `run-sync` moría a los 5 min → se pasó a **async**.
- **`monitoringMode` es por cuenta de Apify**: el captador se comía las novedades y el
  valorador no las veía. Solución: CAP 01 → VAL 02 (punto 4).
- **Tope de 1.000 filas de PostgREST**: devuelve 200 con mil filas y sin aviso.
  Solución: `traerTodo` (punto 5).

---

## 9. Lo que vamos a implementar ahora (y por qué NO rompe nada)

Ambas son **aditivas**: nuevos server actions que, con coordenadas, resuelven el
barrio con **el mismo punto-en-polígono** que ya usamos, y **rellenan los campos
que ya existen** (zona, metros, planta). No tocan la BD, ni la vista, ni el
motor, ni el mapa. Cero replicación.

### A) Dirección → zona automática ✅ HECHO
- Server action `geocodificar(direccion)` → **CartoCiudad** (IGN, gratis, sin key)
  → lat/lng (+ dirección normalizada + refCatastral).
- En el panel **Nueva valoración**: campo "Dirección" con botón **Buscar** →
  geocodifica → punto-en-polígono (cliente, `barrioEnCoords`) → **autorrellena la
  zona** y la resalta en el mapa. Mensaje de confirmación con el barrio detectado.
- No añadió columnas ni cambió el motor. Solo setea `codbarrio` (que ya existía).
- CartoCiudad ya devuelve `refCatastral` → puente natural hacia la opción B.

### B) Dirección → fincas del Catastro ✅ HECHO
- Server action `buscarCatastro(direccion)`: geocodifica con CartoCiudad y con los
  componentes (tipo vía → sigla, calle, número, municipio) llama al **Catastro
  DNPLOC** (JSON, gratis, sin key) → lista de **todas las fincas** del portal.
- Por cada finca: **planta, puerta, escalera, uso** (Residencial/Comercial/…),
  **superficie construida (m²)** y **año**.
- En el panel: al buscar una dirección salen las fincas; eliges la tuya y
  **autorrellena m² y planta**, y ves el **tipo** (piso/local…). El punto de radio
  se fija igual.
- Aditivo: solo prerrellena inputs existentes. No cambia BD ni motor.

> Límite honesto: los geocoders gratis tienen tope de uso. Para valoraciones
> manuales van sobrados; no sirven para miles de llamadas automáticas.

---

## 10. Pendientes / futuro

- **`estado_conservacion`** ✅ ya llega: 2.591 de las 2.961 activas la traen
  (17/09/2026). Queda ver si la **condición** del motor puede pasar a ser data-backed.
- **Rama de bajas** (n8n): el workflow leía `idealista-removed-<runId>` → marcaba
  `activo=false`. **Sustituida**: con pasadas parciales dejó al menos 105 bajas falsas
  (punto 4). Las bajas las decide ya solo `mercado_aplicar_escaneo` (038). El
  **trigger** de `supabase/valorador-bajas.sql` sigue rellenando `precio_baja` y
  `fecha_baja`, y el CRM sigue mostrando **activos vs vendidos/retirados** (puntos
  apagados en el mapa + badge en la lista).
- **Rama de cambios** (n8n, en VAL 01, hoy desactivado): leía
  `idealista-changes-<runId>` → `Update Precio` actualizaba `precio` (y por tanto
  `precio_m2`) e `Insert Historial` lo apuntaba. Al rehacer VAL 01 se va
  `Insert Historial`: el historial lo escribe ya el trigger de la 038.
- **SQL consolidado**: `supabase/valorador-completo.sql` tiene TODO (tablas, vista,
  trigger de bajas, historial de cambios). Idempotente — se puede reejecutar. Lo de
  la 036 y la 038 va aparte, en `supabase/migrations/`.
- **Rehacer VAL 01** como escaneo completo de los domingos, **antes del 11/10**
  (detalle en el punto 4).
- **Desplegar el CRM** para que todo lo anterior quede live: el fix del middleware
  y el de las 1.000 filas (punto 5).
- **Snapshot completo: DECIDIDO trimestral** (antes TODO mensual), pendiente de
  montar. Un run **sin `monitoringMode`** (~4,6 USD) que baje todo el mercado para
  ver los cambios que no son de precio (descripción, fotos…), que con monitoring no
  llegan. No en el mismo ciclo de Apify que el primer escaneo del 11/10: el ciclo
  actual va por ~6,9 USD con previsión de ~15 y el tope está en 17.
- **Fechas del backfill** (opcional, una línea de SQL): en las filas del rescate
  `fecha_primera_vista` (hora de la carga, 17/09) es posterior a `fecha_ultima_vista`
  (fecha de la captura).
- **Ampliar ámbito**: alquiler, locales y área metropolitana necesitan cada uno su
  búsqueda en el escaneo semanal antes de entrar en `mercado_inmuebles`.
- **Seguridad**: el token de Apify y el JWT `service_role` siguen escritos dentro de
  workflows viejos o archivados. Rotación pendiente desde el incidente del 17/08/2026.
