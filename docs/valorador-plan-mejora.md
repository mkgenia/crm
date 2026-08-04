# Valorador — Plan de mejora (ejecutar más adelante)

Objetivo: que la valoración **tenga en cuenta todas las características** de los
comparables (no solo el €/m²), sea **más precisa** y quede **preparada para añadir
variables nuevas** sin rehacer nada. Se ejecuta por fases para no romper lo que hay.

Contexto del análisis (ago 2026): el actor `memo23/idealista-scraper` devuelve un
bloque `moreCharacteristics` muy rico que hoy **NO estamos guardando** casi nada.
Además hay un **bug**: la condición (`status`) se lee de `l.status` (no existe) en
vez de `moreCharacteristics.status` → por eso `estado_conservacion` sale null.

---

## FASE 1 — Capturar TODOS los datos ✅ IMPLEMENTADA (ago 2026)

> Hecho: bug de condición corregido (`mc.status`), columnas promovidas +
> `caracteristicas jsonb` en el SQL, mapeo del workflow construyendo `carac`,
> tipos y `select` de los server actions ampliados, y **chips de características**
> en la lista de comparables (energía A–G con color, condición, exterior, piscina,
> zonas verdes, parking, terraza, trastero, A/A).
> Pendiente del usuario: ejecutar el SQL y reimportar el workflow.
> Los datos se poblarán a partir del siguiente run.

### 1.1 Arreglar el bug de condición
En el nodo **Barrio + Mapeo** del workflow (`Valorador-Venta.json`):
`estado_conservacion: l.status` → **`mc.status`** (valores: `good`, `renew`,
`newdevelopment`). Con esto la condición pasa a ser data-backed.

### 1.2 Campos disponibles a capturar (confirmados en la respuesta real)
De `moreCharacteristics`:
- `communityCosts` (gastos comunidad), `usableArea` (área útil), `constructedArea`
- `exterior` (ext/int → **luminosidad**), `flatLocation` (internal/external)
- `energyPerformance` (kWh/m²) + `energyCertificationType` (a–g → **eficiencia**)
- `swimmingPool` (**piscina**), `garden` (**jardín/zonas comunes**), `boxroom` (**trastero**)
- `lift`, `floor`, `status`, `housingFurnitures` (amueblado), `roomNumber`, `bathNumber`
De top-level: `propertyType`, `extendedPropertyType`, `homeType`, `newDevelopment`,
`has360VHS`, `allowsRemoteVisit`, `energyCertification` (objeto detallado).
Cuando existan (features de Idealista): `terrace`/`balcony`, `airConditioning`,
`parkingSpace`, `orientation`.
⚠️ Parciales/proxy: orientación, vistas, urbanización privada (aproximar con
exterior + planta + garden + swimmingPool).

### 1.3 SQL — guardar todo sin migraciones futuras
Añadir a `mercado_inmuebles`:
```sql
-- columnas "promovidas" (para filtrar/consultar rápido)
alter table mercado_inmuebles add column if not exists usable_area numeric;
alter table mercado_inmuebles add column if not exists exterior boolean;
alter table mercado_inmuebles add column if not exists energia text;       -- a..g
alter table mercado_inmuebles add column if not exists piscina boolean;
alter table mercado_inmuebles add column if not exists garden boolean;
alter table mercado_inmuebles add column if not exists trastero boolean;
alter table mercado_inmuebles add column if not exists parking boolean;
alter table mercado_inmuebles add column if not exists terraza boolean;
alter table mercado_inmuebles add column if not exists gastos_comunidad numeric;
-- todo lo demás (y lo futuro) en jsonb → añadir variables sin ALTER
alter table mercado_inmuebles add column if not exists caracteristicas jsonb;
```
Clave: **`caracteristicas jsonb`** = cajón extensible. Añadir "orientación" mañana
= meterla en el jsonb desde el workflow, sin tocar esquema.

### 1.4 Workflow — construir el objeto de características
En el mapeo, además de los campos promovidos, montar:
```js
caracteristicas: {
  usable_area: mc.usableArea ?? null,
  exterior: mc.exterior ?? null,
  flat_location: mc.flatLocation ?? null,
  energia: mc.energyCertificationType ?? null,
  energia_kwh: mc.energyPerformance ?? null,
  piscina: mc.swimmingPool ?? null,
  garden: mc.garden ?? null,
  trastero: mc.boxroom ?? null,
  amueblado: mc.housingFurnitures ?? null,
  gastos_comunidad: mc.communityCosts ?? null,
  parking: l.parkingSpace?.hasParkingSpace ?? null,
  terraza: l.features?.terrace ?? null,
  aire: l.features?.airConditioning ?? null,
  orientacion: l.orientation ?? null,
  tour360: l.has360VHS ?? null,
  obra_nueva: l.newDevelopment ?? null
}
```
(rellenar también las columnas promovidas con estos mismos valores).

### 1.5 Server actions + tipos
Añadir los campos nuevos a `ComparableInmueble` y a los `select` de
`getComparablesBarrio` / `getComparablesRadio`. Sin cambiar el cálculo todavía.

**Resultado de la Fase 1:** empezamos a acumular TODO desde el próximo run.
El cálculo sigue igual (no se rompe nada). Requiere: SQL + reimportar workflow.

---

## FASE 2 — Motor por semejanza ✅ IMPLEMENTADA (ago 2026)

> Módulo: `src/lib/valorador/semejanza.ts` (puro, sin "use server").
> - `similitud(sujeto, comparable)` → Gower ponderada; solo cuenta variables
>   presentes en AMBOS. Pesos en `PESOS` (añadir variable = añadir peso + 1 línea).
> - `estimarPorSemejanza()` → percentiles **ponderados por similitud²**, con
>   `confianza`, `similitudMedia`, `ajustePct` y `scores` por comparable.
> - Integrado en el panel: si hay semejanza, las bandas usan sus percentiles y
>   **no** se aplican los factores heurísticos (ya están en los datos). Fallback
>   al método antiguo si no hay comparables.
> - UI: comparables **ordenados por parecido**, badge de **% semejanza** por
>   comparable, y bloque **"Cómo se ha calculado"** con confianza alta/media/baja.
>
> Validado con 82 comparables reales: top parecidos 81-85% (92-116 m², 3h, 2b,
> good, ascensor) vs 23% para estudios de 33 m² a 8.200 €/m². Mediana simple
> 3.600 → ponderada 3.385 €/m² (−4,1%): los estudios ya no distorsionan.

### (diseño original)

### 2.1 Idea
Cada comparable **pesa según lo parecido que es** al piso a valorar. En vez de
"mediana de €/m² + % inventados", se hace una **mediana ponderada por semejanza**.

### 2.2 Función de semejanza (distancia de Gower, mixta)
- Numéricas (normalizadas 0–1): m², habitaciones, baños, planta, gastos, energía(kWh),
  distancia geográfica.
- Categóricas/booleanas (0/1): condición, ascensor, exterior, piscina, garden,
  trastero, parking, terraza, tipo, orientación…
- `similitud = 1 - distancia_media` sobre las variables disponibles en ambos.
- **Pesos configurables por variable** (constante en código, fáciles de tunear).
  Añadir una variable nueva = añadir su peso. Extensible por diseño.

### 2.3 Estimación
- Filtrar comparables mínimamente parecidos (mismo tipo, rango de m² ±X%).
- €/m² estimado = **mediana ponderada** por `similitud` de los comparables.
- Bandas: P25/P50/P75 **ponderados** (o similitud-top-K).
- Corrección por **tamaño** (ajustar €/m² según desviación de m² respecto a la media).
- Mantener el toggle −15% venta real.
- Los coeficientes de condición/ascensor/etc. **salen de los datos** (ya no heurísticos).

### 2.4 Explicabilidad
Guardar y mostrar **cuánto pesa cada factor** en el resultado (para que el agente
lo defienda ante el cliente). Ej: "ascensor +3%, a reformar −12%, energía G −4%".

---

## FASE 3 — UI/UX ✅ IMPLEMENTADA (ago 2026)

> - **Inputs nuevos** que alimentan la semejanza: **Luminosidad** (exterior /
>   interior / sin dato) y **Certificado energético A–G** como botones de color.
> - **Comparables**: ordenados por parecido, **badge de % semejanza** por fila
>   (verde ≥70 / ámbar ≥45 / gris), chips de características, miniatura,
>   filtro **"Solo parecidos"** (visual, ≥60%; no altera el cálculo).
> - **Detalle de comparable** (modal): foto grande, chips, tabla completa
>   (superficie útil, gastos comunidad, consumo kWh, estado del anuncio, último
>   precio si está vendido), historial de cambio de precio y link a Idealista.
> - **Resultado**: bloque "Cómo se ha calculado" con base €/m², nº de comparables,
>   parecido medio y **nivel de confianza** (alta/media/baja).
> - El guardado registra el método usado (semejanza, muestra y % de parecido).

### (diseño original)

### 3.1 Panel "Nueva valoración" — inputs por secciones
- **Ubicación**: dirección/catastro (ya) + radio (ya).
- **Básicos**: m² (útil/construido), habitaciones, baños, planta, tipo.
- **Calidad**: condición, ascensor, exterior/luminosidad, **etiqueta energética A–G**
  como selector de colores.
- **Extras** (chips): piscina, jardín/zonas comunes, trastero, parking, terraza,
  balcón, aire, urbanización privada, orientación.
- Autorrelleno desde Catastro (m², planta) — ya está; ampliar con lo que dé.

### 3.2 Comparables — más visuales y con semejanza
- Card de comparable: imagen (ya) + **chips de características** (🏊 piscina, ⚡A,
  🌳 zonas comunes, 🅿️ parking…) + badges (Vendido, ↓ cambió precio) que ya hay.
- **Indicador de semejanza** por comparable ("92% parecido") y **orden por semejanza**.
- **Filtros**: por tipo, rango de m², "solo muy parecidos", con/sin extras.
- Etiqueta energética como badge **A–G con color** (verde→rojo).

### 3.3 Resultado
- Tres bandas (ya) + **nivel de confianza** (según nº de comparables y semejanza media).
- Bloque **"Cómo se ha calculado"**: desglose de ajustes (explicabilidad de 2.4) →
  transparencia y argumento de venta.
- Barra "Posición en el mercado" (ya) enriquecida: marcar dónde caen los vendidos.

### 3.4 Detalle de piso comparable (opcional)
Panel/modal al pulsar un comparable: foto grande, todas sus características, link a
Idealista, historial de precio. Útil para justificar la valoración.

---

---

## FASE 4 — Ajuste hedónico ✅ (ago 2026)

> **Problema detectado en una valoración real** (Dr. Vicente Zaragozá 25): el motor
> elegía comparables parecidos pero **no corregía el precio por las diferencias**.
> Cambiando los extras del sujeto, el precio no se movía (4.135 €/m² siempre) →
> valoraciones infladas.
>
> **Solución** (`precioAjustado` en `semejanza.ts`): cada comparable se normaliza a
> las características del sujeto (*paired sales analysis*). Si el comparable tiene
> parking y el sujeto no, su precio se corrige a la baja antes de entrar al cálculo.
> Además el percentil ponderado ahora **interpola** (antes era escalonado e insensible).
>
> Valores de mercado (`VALOR_ATRIBUTO`, tunear ahí): ascensor 7%, parking 6%,
> piscina 5%, terraza 4%, exterior 4%, jardín 3%, trastero 2%, aire 2%.
> Condición: obra nueva ×1.12, buen estado ×1.0, a reformar ×0.84.
> Energía: A ×1.06 … G ×0.97. Ratio acotado a [0.7, 1.35].
>
> Resultado en el caso real (105 m², 1966, Benimaclet): de **369.049 €** (inflado)
> a **283.280 €** a reformar / **300.773 €** reformado → ~2.700-2.900 €/m²,
> coherente con el barrio.

## Año de construcción — decisión (ago 2026)

Idealista **no** lo devuelve (verificado). El Catastro sí, pero cuesta ~2 s/piso
(~1 h para 1.710) con riesgo de rate-limit. **Decisión: usar solo el año del
sujeto** (que ya viene gratis del Catastro al buscar la dirección) para mostrar la
antigüedad y **guiar la condición** ("Edificio de 1966 — ¿está reformado?").
La condición (−16%) y la letra energética ya aproximan bien la antigüedad.

---

## Auditoría: qué se captura vs qué se usa/edita (ago 2026)

| Variable | Capturada | En semejanza | Editable en panel |
|---|---|---|---|
| **Tipo** (piso/ático/dúplex/estudio/chalet) | ✅ `tipo_detallado` | ✅ peso 3 | ✅ |
| Metros | ✅ | ✅ peso 3 | ✅ |
| Habitaciones / Baños | ✅ | ✅ 2 / 1 | ✅ |
| Condición | ✅ | ✅ peso 2.5 | ✅ |
| Planta | ✅ | ✅ peso 1 | ✅ |
| Ascensor | ✅ | ✅ peso 1.5 | ✅ |
| Luminosidad (exterior) | ✅ | ✅ peso 1 | ✅ |
| Energía A–G | ✅ | ✅ peso 0.8 (ordinal) | ✅ |
| Piscina / Zonas verdes | ✅ | ✅ 0.8 / 0.6 | ✅ (separados) |
| Parking / Trastero / Terraza / A/A | ✅ | ✅ | ✅ |
| Distancia geográfica | ✅ | ✅ peso 2 | (automática) |
| **Balcón** | ✅ solo en jsonb | ❌ | ✅ (solo heurístico) |
| **Superficie útil** | ✅ | ❌ | ❌ (se muestra en detalle) |
| **Gastos comunidad** | ✅ | ❌ | ❌ (se muestra en detalle) |
| Orientación / vistas | ⚠️ casi siempre null en Idealista | ❌ | ❌ |

> ⚠️ Ojo: la columna `tipo` vale siempre `"homes"` y **no sirve**. El bueno es
> `tipo_detallado` (flat/penthouse/duplex/studio/chalet).
>
> Pendientes menores: promover `balcon` a columna para que entre en la semejanza;
> valorar añadir `gastos_comunidad` y `usable_area` como señales (requieren input
> del usuario, que no siempre los conoce).

---

## Orden sugerido de ejecución
1. **Fase 1** completa (SQL + workflow + server actions/tipos) → acumular datos.
2. Esperar 1–2 runs para tener características pobladas.
3. **Fase 2** (motor semejanza) sobre esos datos.
4. **Fase 3** (UI/UX) en paralelo/después, apoyándose en los datos ya ricos.

## Archivos que se tocarán
- `Desktop/Valorador-Venta.json` (mapeo + caracteristicas).
- `supabase/valorador-completo.sql` (columnas + jsonb).
- `src/lib/actions/valorador.ts` (tipos, selects, motor de semejanza).
- `src/components/valorador/valorador-shell.tsx` (inputs, comparables, resultado).
- `src/components/valorador/valorador-map.tsx` (chips/semejanza si aplica).
- `docs/valorador.md` (actualizar cuando se implemente).

## Nota
Todo es **aditivo**. La Fase 1 no cambia el cálculo actual; solo empieza a guardar.
Nada de esto rompe el valorador que ya funciona.
