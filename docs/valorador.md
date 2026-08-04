# Valorador de inmuebles — documentación

Referencia de todas las piezas del valorador: qué hace cada una, cómo encajan
entre sí, y qué vamos a añadir. Objetivo: que nada se solape ni haya que
replicar cosas.

---

## 1. Visión general (el flujo en una frase)

**Scraper (n8n + Apify)** llena una tabla de pisos → **una vista** calcula el
precio medio €/m² por barrio → **el mapa** lo pinta → **al valorar**, se coge la
zona + características del piso y se sacan **tres precios** (verde/amarillo/rojo).

```
Idealista ──(Apify)──> n8n ──> Supabase: mercado_inmuebles
                                         │
                                         ├─> vista mercado_zonas_stats (€/m² por barrio)
                                         │           │
                                         │           ▼
                                         │      Mapa (coropletas)
                                         └─> comparables ──> Motor 3 bandas ──> valoraciones (historial)
```

---

## 2. Capa de datos (Supabase)

SQL en [`supabase/valorador.sql`](../supabase/valorador.sql).

### Tabla `mercado_inmuebles` — la materia prima
Un registro por piso scrapeado de Idealista (activos, agencias y particulares).
Campos clave: `idealista_id` (único), `codbarrio`, `precio`, `metros`,
`precio_m2` (columna **generada** = precio/metros), `habitaciones`, `banos`,
`planta`, `ascensor`, `estado_conservacion`, `anunciante`, `activo`,
`fecha_baja`, `precio_baja`. **De aquí sale todo.**

### Vista `mercado_zonas_stats` — el resumen por barrio
No guarda datos: es una consulta automática que agrupa `mercado_inmuebles` y
calcula por `codbarrio` + `operacion` la **mediana €/m²**, P25, P75 y la muestra.
Es lo que **colorea el mapa**. Se recalcula sola.
> ⚠️ Es una **vista**: se salta el RLS de la tabla base. Por eso el mapa
> funcionaba aunque la tabla tuviera RLS. (Ver punto 8.)

### Informe PDF descargable (2 hojas A4)
En `/valorador/informe/[id]` ([`informe-valoracion.tsx`](../src/components/valorador/informe-valoracion.tsx)).
Acceso: icono de documento en el panel **Historial**. Botón **Descargar PDF** →
`window.print()` → "Guardar como PDF". Sin dependencias, calidad vectorial.

- **Hoja 1**: logo + ref. `VAL-00012`, datos del inmueble, las tres bandas
  (precio de venta destacado), características consideradas, metodología y aviso
  legal (no es tasación ECO/805/2003).
- **Hoja 2**: tabla de **testigos comparables** (zona, m², hab, baños, planta,
  estado + letra energética, equipamiento, precio, €/m², % semejanza) ordenados
  por parecido, más un resumen estadístico (mín/mediana/media/máx) y la fuente.

> Los comparables se guardan como **snapshot congelado** en `valoraciones.comparables`
> (jsonb, máx. 20). Así el informe no cambia aunque el mercado sí. Requiere la
> columna del SQL: `alter table valoraciones add column if not exists comparables jsonb;`

### Tabla `valoraciones` — el historial
Cada valoración guardada desde el CRM: dirección, `codbarrio`, `metros`,
`operacion`, las tres bandas (`valor_min`=verde, `valor_estimado`=amarillo,
`valor_max`=rojo), `muestra` y `notas` (resumen de características).

### Nota RLS
Las 3 tablas se usan **solo desde el servidor** (service key). Tienen RLS
desactivado, igual que el resto del CRM. No exponer con la anon key.

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

Workflow: `Valorador-Venta.json` (en el Escritorio, con las claves puestas).

**Modo asíncrono** (evita el timeout de los runs largos):
```
Cron ─> Config ─> Fetch Barrios ─> Start Run ─> Get Status ─┐
                                        ▲                     │
                                        └── Esperar 25s ◄── ¿Terminado? (no)
                                                              │ (sí)
                                                      Get Items ─> Barrio+Mapeo ─> Supabase Upsert
```
- **Start Run**: lanza el actor `memo23/idealista-scraper` con 3 flags activos:
  `monitoringMode`, `detectPriceChanges`, `detectRemovedListings`.
- **Barrio+Mapeo**: asigna `codbarrio` por punto-en-polígono (lat/lng vs geojson),
  con fallback por nombre. Mapea campos de Apify → columnas de la tabla.
- **Supabase Upsert**: `on_conflict=idealista_id` (no duplica; refresca).

`monitoringMode` hace que en cada run solo traiga **novedades** (o refresque),
no las 500 otra vez.

---

## 5. Server actions — [`src/lib/actions/valorador.ts`](../src/lib/actions/valorador.ts)

Todas usan el cliente admin (service key). Puente entre la UI y Supabase.

| Función | Qué hace |
|---|---|
| `getZonasStats(operacion)` | Lee la vista → stats €/m² por barrio. **Colorea el mapa.** |
| `getComparablesBarrio(codbarrio, operacion)` | Pisos individuales de un barrio. **Panel de comparables.** |
| `getValoraciones()` | Lista el historial. |
| `crearValoracion(input)` | Guarda una valoración (las 3 bandas). |
| `eliminarValoracion(id)` | Borra del historial. |
| `getFactoresMercado(operacion)` | Calcula coeficientes **con datos reales** (hoy: factor ascensor con/sin). |

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
  (la vista no, por eso el mapa sí iba). Solución: RLS desactivado en las tablas.
- **Middleware**: `crm.mkgenia.com/valencia-barrios.geojson` redirigía a `/login`
  → n8n no bajaba el geojson → pisos sin barrio. Solución: el matcher de
  [`middleware.ts`](../src/middleware.ts) excluye `.geojson/.json/.xml/.txt`.
- **codbarrio duplicado**: dos barrios compartían el código `175` en los datos
  oficiales → clave repetida en React. Se hizo único (`175` y `175-2`).
- **Timeout del scraper**: `run-sync` moría a los 5 min → se pasó a **async**.

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

- **`estado_conservacion` llega null** del scraper → arreglar el mapeo del
  workflow para capturarla. Entonces la **condición** pasaría a ser data-backed.
- **Rama de bajas** (n8n) ✅ HECHO: el workflow lee el dataset `idealista-removed-<runId>`
  → marca `activo=false`. Un **trigger** (`supabase/valorador-bajas.sql`) rellena
  `precio_baja` y `fecha_baja`. El CRM muestra los comparables **activos vs
  vendidos/retirados** (puntos apagados en el mapa + badge en la lista).
- **Rama de cambios** (n8n) ✅ HECHO: lee `idealista-changes-<runId>` → actualiza
  `precio` en `mercado_inmuebles` (y por tanto `precio_m2`) + registra cada cambio
  en `mercado_precio_historial`. SQL en `supabase/valorador-completo.sql`.
- **SQL consolidado**: `supabase/valorador-completo.sql` tiene TODO (tablas, vista,
  trigger de bajas, historial de cambios). Idempotente — se puede reejecutar.
- **Desplegar el CRM** para que todo lo anterior quede live (y el fix del
  middleware surta efecto).
- **[TODO] Snapshot mensual de limpieza**: un run puntual (p.ej. 1×/mes) del actor
  **sin `monitoringMode`** que baje TODO el mercado y refresque las filas ya
  existentes (precio, fecha_ultima_vista). Con monitoring, un piso que sigue igual
  no se re-scrapea; este snapshot da una foto 100% fresca de golpe. Más caro/lento,
  por eso solo mensual. Se puede hacer como 2º workflow o un toggle. (Aplazado.)
