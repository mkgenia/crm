# Captador automático — workflows de n8n

Cinco workflows que alimentan la página **Captaciones** del CRM. Sustituyen a los
cuatro anteriores (`Idealista Scraper (Venta)`, `Auto-Contacto (Venta)`,
`Generador Mensaje IA (Venta)` y `Flujo 4 - Clasificar Respuestas WhatsApp`).

```
┌─ 1 · Scraper ─────────────────────────────────────────────────────┐
│ cada 30 min (9-21h) + red de seguridad diaria 07:00               │
│ presupuesto Apify → zonas activas → 1 run multi-URL → normalizar  │
└────────────────────────────┬──────────────────────────────────────┘
                             │ 1 llamada por inmueble
┌─ 2 · Ingesta ───────────────▼─────────────────────────────────────┐
│ upsert captaciones · fotos WebP → Storage · cambios de precio     │
│ NO envía nada                                                     │
└───────────────────────────────────────────────────────────────────┘

┌─ 3 · Cola de WhatsApp ────────────────────────────────────────────┐
│ cada 6 min (10-14h y 16-21h, L-S) · 1 mensaje por turno como      │
│ máximo · tope diario · reserva atómica · dedupe por teléfono      │
└────────────────────────────┬──────────────────────────────────────┘
                             │
┌─ 4 · Generador de mensaje ──▼─────────────────────────────────────┐
│ comparables del barrio → ángulo → plantillas → GPT-4.1-mini       │
│ lo llaman la cola y el botón "Generar con IA" del CRM             │
└───────────────────────────────────────────────────────────────────┘

┌─ 5 · Clasificar respuestas ───────────────────────────────────────┐
│ webhook de Evolution cuando el propietario CONTESTA               │
│ hilo de conversación → GPT → estado_whatsapp + estado_crm + lead  │
└───────────────────────────────────────────────────────────────────┘
```

La separación entre **ingesta** y **envío** es lo que permite capturar todo lo que
aparezca en Idealista sin que WhatsApp vea una ráfaga: se guardan 40 captaciones
en 10 minutos y se escriben 25 repartidas a lo largo del día.

---

## 1. Migración de base de datos

Ejecuta `supabase/migrations/003_captador_v2.sql` en el SQL Editor de Supabase
**antes** de activar nada. Es idempotente y no destructiva.

Y después `supabase/migrations/004_zonas_configurables.sql`, que es la que convierte
las zonas en configuración de verdad:

| Qué | Para qué |
|---|---|
| `scraper_zonas.operacion` / `tipo_inmueble` / `ventana_horas` | Cada zona con su URL y su vocabulario. Sin esto se puede crear una zona, pero no etiquetarla. |
| Borra el trigger de "una sola zona activa" | **Es lo importante.** Sin ejecutarla, activar locales apaga viviendas. |
| `CHECK` de alquiler a 24 h | Idealista no tiene ventana de 48 h en alquiler: la zona saldría muda. |
| `CHECK` de `tipo` con `'url'` | Para poder guardar zonas pegando la URL. |

| Qué | Para qué |
|---|---|
| `captaciones.contacto_lock_en` | Reserva atómica de un turno de la cola. |
| `captaciones.ultimo_contacto_en` | Sello del intento **antes** de enviar. Evita el mensaje duplicado y alimenta el tope diario. |
| `captaciones.fotos_procesadas` | Evita reprocesar las mismas fotos en cada pasada. |
| `captaciones.precio_anterior` / `precio_actualizado_en` | Detección de bajadas de precio. |
| `estado_whatsapp` + `Sin_WhatsApp` y `Duplicado` | Dos estados terminales explícitos. |
| Normalización de teléfonos a `34XXXXXXXXX` | Ver más abajo: sin esto todo el histórico acaba en `Sin_WhatsApp`. |
| `scraper_zonas.ultima_ejecucion` / `ultimo_resultado` | Panel de configuración del CRM. |
| `leads`: índice único por `captacion_id` + unificación de `fuente` | Un lead por captación; una sola etiqueta de origen. |
| `app_settings.wa_limite_diario` / `apify_uso_mes` | Tope de mensajes y medidor de gasto. |

**`estado_whatsapp` era `NOT NULL` con `DEFAULT 'Pendiente'`.** No aparece en ninguna
migración del repo y por la API REST no se ve; salió ejecutando el sistema de verdad.
Quitar solo el DEFAULT dejaba cualquier `INSERT` que omitiera el campo —lo hacen todos
los workflows— con un NULL que violaba la restricción, y **la ingesta se caía entera
con un 400**. Por eso las dos sentencias del bloque 2b van juntas: `DROP NOT NULL` y
`DROP DEFAULT`. NULL es lo que el diseño usa para "en cola".

**La migración no lleva ningún backfill de `contacto_lock_en`.** La cola exige
`estado_whatsapp=is.null` *y* `contacto_lock_en=is.null`, así que todo lo ya
contactado queda fuera por la primera condición sola; marcar además el lock no
cambiaría la elegibilidad de ninguna fila.

**Las 71 captaciones en `'Pendiente'` quedan fuera del automatismo.** Nunca se
contactaron, y meterlas de golpe en la cola serían 71 WhatsApps a personas reales. Se
rescatan de una en una con el botón "Reintentar" del panel de detalle.

**Tampoco backfill de `fotos_procesadas`.** El flujo antiguo guardaba en `imagenes`
URLs con forma correcta (`…/captaciones/<id>/img_0.webp`) que apuntan a objetos que
nunca llegaron al bucket: subía todo a `captaciones/undefined/img_undefined.webp`.
Dar esas filas por procesadas desactivaría para siempre la repesca del workflow 2,
que es justo lo que tiene que arreglarlas.

### La normalización de teléfonos es obligatoria

El scraper antiguo guardaba `contactInfo.phone1.phoneNumber` en crudo: **9 dígitos
sin prefijo**. La cola nueva manda `captaciones.telefono` tal cual a Evolution, que
para un número sin prefijo responde `exists:false` → la captación queda marcada
`Sin_WhatsApp` de forma permanente. Sin la migración, eso le pasaría a **todo el
histórico** la primera noche.

La migración normaliza a `34XXXXXXXXX` y deja intacto lo que no encaje (para que el
agente lo siga viendo); la cola lo descarta con `telefono=like.34*`.

---

## 2. Credenciales de n8n

Créalas **antes** de importar, con estos nombres exactos: al importar, n8n las
empareja por nombre.

| Nombre | Tipo | Contenido |
|---|---|---|
| `Supabase mkgenia (service_role)` | Custom Auth | `{"headers":{"apikey":"<SERVICE_ROLE>","Authorization":"Bearer <SERVICE_ROLE>"}}` |
| `Apify (Bearer)` | Header Auth | Nombre `Authorization`, valor `Bearer <APIFY_TOKEN>` |
| `Evolution API (apikey)` | Header Auth | Nombre `apikey`, valor `<EVO_API_KEY>` |
| `n8n Interno (x-webhook-secret)` | Header Auth | Nombre `x-webhook-secret`, valor `<WEBHOOK_SECRET>` |
| `Evolution Webhook (x-evolution-secret)` | Header Auth | Nombre `x-evolution-secret`, valor a tu elección |

Supabase necesita **dos** cabeceras (`apikey` + `Authorization`), así que es Custom
Auth y no Header Auth, que solo guarda un par nombre/valor.

`Redis account`, `OpenAi account` y `Google Service Account account` ya existen y se
reutilizan por su ID.

### Rotar las claves: el orden importa

El `service_role` de Supabase, el token de Apify, la apikey de Evolution y el
`sb_secret_…` estaban en claro dentro de los JSON exportados. Hay que rotarlos, pero
**primero** hay que migrar el workflow 5, porque el Flujo 4 antiguo sigue activo con
los valores incrustados y su nodo `Actualizar Lead` lleva `continueOnFail`: si rotas
antes, las respuestas de los propietarios dejan de clasificarse sin que salte nada.

Secuencia: crear credenciales → importar y verificar los 5 workflows → rotar claves →
borrar los JSON antiguos de `Downloads` y podar el historial de ejecuciones de n8n
(las cabeceras quedan guardadas por ejecución).

### Variables de entorno del CRM

```
WEBHOOK_SECRET=<el mismo valor que la credencial n8n Interno>
NEXT_PUBLIC_N8N_WEBHOOK_IA_LEAD_GEN=https://test-n8n.pzkz6e.easypanel.host/webhook/ia-lead-gen
EVO_API_URL / EVO_API_KEY / EVO_INSTANCE   # ya existen
```

---

## 3. Importar

1. **Desactiva los cuatro workflows antiguos.** Los nuevos 4 y 5 reutilizan las rutas
   `ia-lead-gen` y `evolution-respuesta-wa`, y n8n no admite dos activos con la misma.
2. Importa los cinco JSON de esta carpeta.
3. Abre cada nodo con credencial y confirma que está seleccionada.
4. **Configura la cabecera en Evolution** antes de activar el workflow 5: en la config
   del webhook de tu instancia, añade `x-evolution-secret` con el valor de la
   credencial. Si tu versión de Evolution no soporta cabeceras propias, quita
   `authentication` del nodo `Webhook Respuesta WA` — es preferible un webhook abierto
   a dejar de clasificar todas las respuestas en silencio.
5. Actívalos en orden **4 → 2 → 5 → 3 → 1** (los que reciben, antes que los que llaman).
6. En el CRM: Captaciones → Configuración → activa zonas y sube el auto-contacto.

Los workflows llegan con `active: false` a propósito.

---

## 4. El presupuesto de $19

La cuenta es plan **STARTER** con tope duro de 19 $/mes. Cuando se agota, Apify
corta los runs: el captador se quedaría mudo el día 20 sin avisar.

**Tarifas** (pago por evento):

| Evento | Precio |
|---|---|
| Arranque del actor | $0.007 por run (memoria 512 MB = 1 evento) |
| Fila de resultado | $0.001 |
| Sobrecoste de `monitoringMode` | +$0.001 por fila emitida |

**Estimación con la configuración por defecto** (3 zonas activas, filtro
*solo particulares* puesto, ~15 anuncios nuevos por zona y día):

| Concepto | Cálculo | Mes |
|---|---|---|
| Arranques | 26 runs/día × 30 × $0.007 | $5.46 |
| Modo rápido (solo nuevos) | 45 filas/día × 30 × $0.002 | $2.70 |
| Red de seguridad (48 h, sin monitoring) | ~90 filas/día × 30 × $0.001 | $2.70 |
| **Total** | | **≈ $10.9** |

Quedan ~$8 de margen. **Sin el filtro `de-particulares` esto se va por encima de
los $19**: pagarías las filas de agencia, que son la gran mayoría de los anuncios,
para tirarlas después en el nodo de normalizado.

### Los tres frenos

1. **Guardarraíl de ritmo** (nodo `Control de Presupuesto`). Antes de cada pasada
   consulta el gasto real en Apify y lo compara con lo que tocaría a estas alturas
   del ciclo. Si va por delante, salta la pasada. Reserva $2 intocables.
2. **`maxTotalChargeUsd` por run**: $0.35 en modo rápido, $1.00 en la red de
   seguridad. Es un tope que aplica Apify, no n8n.
3. **`maxItems`**: 150 en modo rápido, 400 en la red de seguridad.

El gasto se publica en `app_settings.apify_uso_mes` y se ve en el panel del CRM.

### Palancas para ampliar

- **Más zonas activas**: cuestan casi nada. Todas van en el mismo run, así que el
  arranque ($0.007, el grueso del gasto) se paga una sola vez.
- **Más frecuencia**: cada 15 min en vez de 30 duplica los arranques (+$5.5/mes).
- **`marketAnalysis: true`**: $0.15 por área, cacheado 90 días. Una pasada mensual
  por zona (~$0.45) daría alquiler medio, rentabilidad y ADR reales para el mensaje.
  No está montado; es el siguiente paso natural.

---

## 5. El ritmo de WhatsApp

Todo el envío pasa por el workflow 3, único punto que escribe a nadie. Cuatro capas:

1. **Horario**: solo 10-14 h y 16-21 h, de lunes a sábado.
2. **Un mensaje por turno** como máximo, y los turnos son cada 6 minutos.
3. **Salto aleatorio del 45%** de los turnos. Sin él los mensajes saldrían clavados
   cada 6 minutos, y esa regularidad milimétrica es de los primeros patrones que usa
   WhatsApp para marcar una cuenta como automatizada. Con el salto, el hueco real
   queda entre 6 y ~30 minutos, irregular. Más una pausa de 20-90 s antes de enviar.
4. **Tope diario** (`wa_limite_diario`, por defecto 25), que cuenta también los
   envíos manuales del agente: el cupo es global.

Si el número es nuevo, empieza en 10-15/día durante un par de semanas.

**Para pausar el envío sin parar la captura**: baja el interruptor de auto-contacto.
El scraper sigue guardando y todo queda en cola.

### Por qué nadie recibe dos mensajes

- **Reserva atómica** (`contacto_lock_en`): el PATCH solo afecta a filas sin lock. Si
  no devuelve fila, otro turno la tiene y este se para. Sin reintentos a propósito.
- **Sello previo** (`ultimo_contacto_en`): se escribe **antes** de llamar a Evolution.
  Si el mensaje sale pero la respuesta HTTP se pierde, `Marcar Enviado` nunca corre y
  la fila se queda con `estado_whatsapp` NULL — pero con el sello puesto ni la cola ni
  el limpiador de reservas la vuelven a coger. El agente la ve en el CRM con
  "Envío sin confirmar · reintentar".
- **Salidas de error sin conectar**: si falla Evolution o la IA, la reserva se queda
  puesta y `Liberar Reservas Caducadas` reintenta a las 2 h. Soltarla al instante
  hacía que la misma fila envenenada fuera cabeza de cola cada 6 minutos.
- **Dedupe por teléfono**: un particular con dos anuncios en la zona recibía dos
  mensajes distintos del mismo agente. El segundo se marca `Duplicado`, no consume
  cupo y queda registrado en el historial.

---

## 6. El mensaje

El workflow 4 no le pide al modelo que decida nada: el análisis va en código y el
modelo **solo redacta**. Así no puede inventarse un dato.

### Venta y alquiler no reciben el mismo mensaje

La tabla `captaciones` mezcla las dos cosas — **331 ventas y 514 alquileres** —, así
que lo primero que hace el generador es mirar `raw_data.operation`. Si falta el dato,
una red de seguridad lo deduce del precio: tres o cuatro cifras solo pueden ser una
renta mensual.

| | Venta | Alquiler |
|---|---|---|
| Propuesta de valor | te encargas tú de la operación: perfiles, filtrar visitas, negociar, papeleo | **inquilinos solventes con Seguro de Impago Caser aprobado**, perfiles gratis y sin compromiso |
| Trato | el de las plantillas (hoy, tuteo) | de usted |
| Formato | texto normal | `*negritas*` de WhatsApp, sin emojis |
| Plantillas | Google Doc `1dMpbi9…` | escrita en el propio nodo |
| Umbral de "estancado" | 45 días | 30 días — el alquiler se mueve más rápido |

El discurso de alquiler no está inventado: es el que ya usaba tu
`Generador Mensaje IA (Alquiler)`, recuperado tal cual.

### Y tampoco lo reciben igual un piso y una nave

Con la segunda zona (locales) el eje "venta/alquiler" ya no basta: a quien vende un
local no se le puede escribir *"su piso"*, ni hablarle de un tercero sin ascensor.
El generador lee `raw_data.propertyType` y de ahí sale todo el vocabulario:

| `propertyType` | Se le llama | Compradores | Inquilinos |
|---|---|---|---|
| `homes` | su vivienda | compradores | inquilinos |
| `premises` | su local | inversores y negocios | negocios |
| `offices` | su oficina | empresas e inversores | empresas |
| `garages` | su plaza de garaje | compradores de la zona | vecinos de la zona |
| `lands` | su terreno | promotores e inversores | interesados |
| `storageRooms` | su trastero | compradores de la zona | vecinos de la zona |
| *(cualquier otro)* | su inmueble | compradores | inquilinos |

Esa última fila es deliberada: si mañana se activa una zona de un tipo que no está en
la tabla, el mensaje sigue saliendo correcto en vez de romperse.

Los datos que se mencionan también se filtran por tipo, porque no todos existen:
de 15 locales reales, **0 traían `roomNumber` y 15 traían `constructedArea`**. Las
habitaciones y la planta solo se mencionan en vivienda; la **salida de humos**, solo en
local u oficina — es lo primero que pregunta quien quiere montar hostelería. El umbral
de "estancado" sube a 60 días en comercial: ese mercado se mueve mucho más despacio.

### Lo que el mensaje NO dice

Hubo dos señales que parecían buenos ganchos y hubo que quitarlas después de verlas
en una prueba en vivo:

- *"el anuncio tiene solo 2 fotos"* → el modelo escribió **"Observo que su anuncio
  tiene solo dos fotografías"**.
- *"la descripción es muy escueta"*, y *"es un 3º sin ascensor"*.

Y una cuarta que se vio ya en producción: un **"Buenas tardes" a las 11:12 de la
mañana**. El modelo saludaba a ojo y el servidor de n8n va en UTC, así que ahora se le
pasa la hora de España calculada con `Europe/Madrid`. Se le da la hora, no el saludo
escrito: así el texto con acentos lo produce él y no viaja por el generador de código.

Las tres primeras son correctas y las tres son un error: en el primer mensaje le estás
criticando el trabajo o señalándole un defecto a alguien que aún no te conoce, que es
lo contrario de generar confianza. Ahora solo se mencionan rasgos del **inmueble**
(metros, habitaciones, salida de humos, a reformar), nunca de cómo está hecho el
anuncio. La regla 1b del prompt cierra la otra puerta: tampoco se le pueden atribuir
requisitos a los clientes (*"busco compradores de unos 80 m²"*).

### Los ángulos

Se elige uno por prioridad, y el "gancho" que recibe el modelo lleva las cifras ya
calculadas:

| Ángulo | Cuándo | Venta | Alquiler |
|---|---|---|---|
| `bajada_de_precio` | hay `precio_anterior` | "he visto que ha ajustado el precio" | "suele significar que lleva tiempo sin alquilarse" |
| `anuncio_estancado` | ≥45 d (venta) / ≥30 d (alquiler) | "el problema suele estar en el precio o en el anuncio" | "lleva X semanas sin alquilarse" |
| `recien_publicado` | ≤3 días | "le van a llover llamadas de agencias" | "va a recibir muchos mensajes; el trabajo es filtrar cuáles pagan" |
| `generico` | resto | presentación + valoración gratuita | la plantilla con los perfiles solventes |

Si hay una **señal** del anuncio (a reformar, planta alta sin ascensor, pocas fotos,
descripción muy escueta) se añade al gancho como detalle real de apoyo.

> **Sin comparables.** El diseño tuvo una fase con mediana de €/m² del barrio, y se
> retiró: la tabla mezcla venta y alquiler en 63 barrios, así que la mediana salía
> contaminada (un piso en venta comparado contra una mediana de rentas mensuales daba
> desviaciones de +14.000%). Si algún día se quiere recuperar, hay que calcularla
> filtrando por operación.

### Dos limpiezas que importan

- **`Subdistrict`**: Idealista devuelve el barrio como `Subdistrict Els Orriols`. Ese
  prefijo en inglés se colaba literal en el mensaje al propietario y delataba que era
  automático. Se limpia solo para redactar; el valor guardado no se toca.
- **`No especificada`**: el scraper antiguo guardaba ese literal en vez de dejar el
  campo vacío. Pasárselo al modelo solo servía para que escribiera "su piso, planta no
  especificada".

Las plantillas de venta se leen en un nodo normal y no como *tool* del agente: un
agente puede saltarse una tool por mucho "PROCESO OBLIGATORIO" que ponga el prompt.

---

## 7. La clasificación de respuestas

El workflow 5 se dispara con el webhook de Evolution cuando el propietario contesta.
Cambios respecto al Flujo 4 que sustituye:

- **Usa el hilo de la conversación de verdad.** El anterior hacía dos llamadas a
  `/chat/findMessages` (una por `@s.whatsapp.net` y otra por `@lid`) encadenadas, y el
  nodo siguiente **descartaba las dos**: leía el texto directamente del webhook. Eran
  código muerto en el camino crítico cuyo fallo tumbaba la clasificación. Ahora es una
  sola llamada, con el JID que trajo el webhook, y su resultado se usa.
- **Se quitó la regla que anulaba el contexto.** El system prompt decía "si el último
  mensaje es negativo clasifica No_Interesado aunque los anteriores fueran positivos".
  Con eso, un propietario en plena negociación que escribe "no, el jueves no puedo"
  acababa con la captación y el lead en `Perdido`.
- **No degrada el trabajo del agente.** Si la captación ya pasó de Contactado /
  Interesado (Propuesta, Negociación, Ganado), solo se registra la señal de WhatsApp y
  el `estado_crm` se deja como está.
- **Resuelve los JID `@lid`.** WhatsApp está migrando a ese direccionamiento, donde el
  `remoteJid` no es el teléfono sino un identificador opaco de 15+ dígitos. El flujo
  anterior le cogía los últimos 9 dígitos y buscaba por sufijo: emparejaba con la
  captación de **otro** propietario y le escribía el estado encima.
- **Corta los eventos sin teléfono.** Un `status@broadcast` daba sufijo vacío, el
  filtro quedaba en `telefono=ilike.*` (comodín) y se clasificaba una captación al azar.
- **Crea el lead si no existe.** El `PATCH /leads?captacion_id=eq.X` afectaba a cero
  filas siempre que el agente había contactado a mano (esa vía no creaba lead), y
  PostgREST devolvía 204 sin error. El propietario interesado no aparecía en `/leads`.
- **Desempata por `ultimo_contacto_en`.** Con `limit=1` sin `order`, dos anuncios del
  mismo propietario devolvían una fila arbitraria.
- **Ya no filtra `estado_whatsapp=not.eq.Pendiente`**, que en PostgREST también excluye
  las filas NULL: si el envío salió pero `Marcar Enviado` falló, la respuesta no
  encontraba su captación.

---

## 8. Ajustes rápidos

| Quiero | Dónde |
|---|---|
| **Crear una zona nueva** (operación, tipo, ventana) | CRM → Captaciones → Configuración → Añadir |
| **Activar o desactivar una zona** | CRM → Captaciones → Configuración |
| Cambiar la frecuencia de scrapeo | WF1 → `Cada 30 min (9-21h)` → cron |
| Cambiar el horario de envío | WF3 → `Turno de Cola` → cron |
| Cambiar el tope diario | CRM → Captaciones → Configuración |
| Cambiar el presupuesto Apify | WF1 → `Control de Presupuesto` → `LIMITE_CUENTA` / `RESERVA` |
| Cambiar el tono del mensaje | Google Doc `1dMpbi9…` |
| Cambiar los umbrales de los ángulos | WF4 → `Analizar Inmueble` |
| Ajustar la clasificación | WF5 → constante `SISTEMA` del nodo `Clasificar Respuesta` |
| Pausar solo el envío | CRM → interruptor de auto-contacto |

### Las zonas son configuración, no código

Las tres primeras filas son la diferencia práctica: **añadir una zona de alquiler de
locales, o pasar una de 24 h a 48 h, ya no obliga a tocar n8n**. Cada fila de
`scraper_zonas` lleva su `operacion`, su `tipo_inmueble` y su `ventana_horas`
(migración 004), y el scraper monta la URL de cada una en la misma pasada de Apify.

La **ventana por zona** no es un capricho. Con una sola cifra global no salen las
cuentas: vivienda en Valencia mueve ~375 anuncios en 48 h (y con 24 h ya va sobrada),
mientras que locales dio **13 en 48 h y 0 en 24 h**. Una constante global o deja fuera
los mercados finos, o duplica el gasto en los gruesos.

Un detalle que costaba dinero: si la URL de una zona **no lleva** segmento `/con-.../`,
antes se enviaba tal cual a Apify, es decir *el histórico entero de Valencia cada 30
minutos*. Ahora la ventana se inyecta siempre, y si la URL ya trae otros filtros
(precio, dormitorios) se conservan.

---

## 9. Comprobaciones tras el despliegue

1. **WF1 a mano** → termina y deja `ultima_ejecucion` en las zonas activas.
2. **Storage** → `captaciones/<id>/img_0.webp`. Las carpetas `undefined` son de los
   workflows antiguos: se pueden borrar.
3. **WF4 a mano** con un `captacion_id` real → responde `{"message":"..."}` y en
   `Analizar Inmueble` se ve el ángulo elegido y la mediana de la zona.
4. **WF3** → con el auto-contacto apagado termina en `Decidir Turno` sin hacer nada.
5. **WF5** → responde desde un móvil a un mensaje del captador y comprueba que la
   captación cambia de estado, que el lead aparece en `/leads` y que se registra el
   historial.
6. **Teléfonos** → tras la migración, `SELECT count(*) FROM captaciones WHERE telefono
   IS NOT NULL AND telefono !~ '^34[6-9][0-9]{8}$'` debería ser bajo. Lo que quede son
   números extranjeros o texto y hay que revisarlos a mano.
7. **CRM** → el panel de configuración muestra el gasto de Apify y la cola.

### Lo que las URLs de Idealista aceptan y lo que no

Todo esto está probado contra el actor, no supuesto. Son las cuatro cosas que hacen
que una zona nueva capte o se quede muda:

| | Resultado |
|---|---|
| `/venta-<tipo>/valencia-valencia/con-publicado_ultimas-24-horas/` | **funciona** con los seis tipos: viviendas, locales, oficinas, garajes, trasteros, terrenos |
| `/areas/…?shape=((…))` (polígono) | **funciona** — es la forma de las zonas en producción |
| `/buscar/…?q=Ruzafa` (búsqueda por nombre) | **cero anuncios**, con ventana y sin ella |
| `de-particulares` | **no existe**: suelto da "No results found", dentro de `/con-` se ignora y siguen saliendo agencias |
| `alquiler-*` con `publicado_ultimas-48-horas` | **cero anuncios** (repetido dos veces); a **24 h sí funciona** |

Las dos últimas filas costaron una recomendación equivocada por mi parte y una zona
que se habría quedado callada sin decir por qué, así que están tanto en el formulario
(48 h aparece deshabilitado en alquiler) como en un CHECK de la base.

Por eso el formulario ya no ofrece "Por nombre" y sí ofrece **Pegar URL**: buscas en
Idealista como quieras, compruebas que salen anuncios, y pegas esa URL. El enlace
**Comprobar** al lado de la URL generada sigue ahí — Idealista responde 403 a todo lo
que no sea un navegador, así que la única validación fiable es abrirla tú.

### Una zona ya no apaga a las demás

Había un trigger en `scraper_zonas` que, al activar una zona, desactivaba el resto. Se
descubrió al activar la de locales: la de viviendas se apagó sola. Venía del diseño
viejo, cuando cada zona era un run de Apify aparte. Ahora todas las zonas activas
viajan en el **mismo** run, así que el arranque del actor se paga una sola vez tanto
con una zona como con cuatro. La migración 004 borra ese trigger.
