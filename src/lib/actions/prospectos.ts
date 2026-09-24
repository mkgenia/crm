"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import { crearProspectoEnInmovilla } from "@/lib/actions/inmovilla"

/**
 * Los prospectos: lo que empieza cuando el propietario dice que sí.
 *
 * Una captación es un anuncio de Idealista que el scraper ha traído y que el
 * scraper vuelve a pisar en cada pasada. Un prospecto es la COPIA editable de
 * esa ficha, congelada en el momento del salto, más el embudo del trato
 * (`prospectos.estado`: Nuevo · Captado · Perdido). La migración 022 explica por
 * qué es una tabla nueva y no una columna más en `captaciones`.
 *
 * Aquí no se reimplementa nada de lo que ya hace la base de datos: el salto
 * entero —resolver o crear el contacto, copiar la ficha, congelar quién la
 * captó, colgar la agenda y dejar rastro— es una sola transacción dentro de
 * `promocionar_captacion()`. Repetir esos seis pasos desde Node sería seis
 * viajes que se pueden quedar a medias.
 */

/** Las rutas que enseñan un prospecto o lo cuentan. Se revalidan juntas. */
function revalidarProspectos(id?: string) {
  revalidatePath("/prospectos")
  // Literal, no patrón: `id` es un uuid concreto y no hace falta el `type`.
  if (id) revalidatePath(`/prospectos/${id}`)
  // `v_mi_dia` mezcla captaciones y prospectos, y el bloque de "Mi día" se pinta
  // en el servidor: sin esto, el prospecto recién creado no sale en la pantalla
  // que el agente abre por la mañana.
  revalidatePath("/dashboard")
}

/**
 * El uuid llega del navegador, así que se comprueba antes de meterlo en una
 * consulta. No es paranoia de tipos: `.or()` de PostgREST parsea su filtro como
 * texto, y un id con una coma dentro reescribiría la consulta entera.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// EL SALTO
// ---------------------------------------------------------------------------

export interface ResultadoPromocion {
  ok?: true
  prospectoId?: string
  contactoId?: string
  /** No es un error: la captación ya se había promocionado antes. */
  yaExistia?: boolean
  /** La referencia con la que ha quedado en Inmovilla, si ha subido. */
  inmovillaRef?: string
  /** Por qué no ha subido a Inmovilla. El prospecto existe igual. */
  inmovillaError?: string
  error?: string
}

/**
 * Captación → prospecto. Es el botón que cierra el circuito.
 *
 * Quién la promociona sale de la sesión y NUNCA del navegador: `p_agente_id` es
 * quien queda como `creado_por` y, si la captación no tenía dueño, también como
 * `captado_por` —el dato que sostiene el "captado por Raúl" y que ya no se pisa
 * nunca más—. Aceptarlo por parámetro sería dejar que cualquiera se apunte
 * captaciones ajenas.
 *
 * La función SQL es IDEMPOTENTE por índice único (`prospectos_captacion_uidx`),
 * que es lo que hace que dos clics seguidos —dos peticiones distintas, no un
 * doble render— no creen dos prospectos del mismo piso. Cuando ya estaba
 * promocionada devuelve `creado:false`, y eso NO es un error: es la respuesta
 * correcta y trae el id del prospecto que ya existe para poder llevar allí a
 * quien pulsó.
 */
export async function promocionarCaptacion(captacionId: number): Promise<ResultadoPromocion> {
  const { userId, isAdmin } = await sesionActual()

  // `sesionActual` ya redirige al login cuando no hay nadie, pero la RPC es
  // SECURITY DEFINER y se salta las RLS: si esa redirección dejara de cortar,
  // esto crearía un prospecto a nombre de un agente vacío. Misma doble puerta
  // que en `atender`.
  if (!userId) return { error: "Se ha cerrado la sesión: vuelve a entrar" }

  if (!Number.isInteger(captacionId)) return { error: "Esa captación no existe" }

  const supabase = await createAdminClient()

  // Se lee la fila antes de llamar por una sola razón: saber si quien pulsa
  // puede hacerlo. Lo demás (que exista, que tenga teléfono, que ya estuviera
  // promocionada) lo decide la función SQL, que es quien tiene el cerrojo.
  const { data: cap, error: errCap } = await supabase
    .from("captaciones")
    .select("id, agente_id")
    .eq("id", captacionId)
    .maybeSingle()

  if (errCap) return { error: errCap.message }
  if (!cap) return { error: "Esa captación ya no existe" }

  // Un agente promociona lo suyo y lo que no lleva nadie. Lo de un compañero,
  // no: el prospecto congela `captado_por` y eso no se arregla después.
  if (!isAdmin && cap.agente_id && cap.agente_id !== userId) {
    return { error: "Esta captación la lleva otro agente" }
  }

  const { data, error } = await supabase.rpc("promocionar_captacion", {
    p_captacion_id: captacionId,
    p_agente_id: userId,
    // El destino 'propiedad' lo rechaza la propia función con un motivo (la
    // cartera la publica Inmovilla y el CRM no puede inventarse una
    // referencia). Se manda explícito para que se lea aquí lo que se pide.
    p_destino: "prospecto",
    // Nombre y teléfono los saca la función de la propia captación. Se pasan
    // nulos y no se omiten para que la llamada nombre los cinco parámetros que
    // tiene la función y no dependa de sus DEFAULT.
    p_nombre: null,
    p_telefono: null,
  })

  // Los mensajes de esta RPC están escritos para leerse: "Esta captación no
  // tiene un teléfono válido. Añádelo antes de promocionar." dice qué hacer. Se
  // devuelven tal cual; taparlos con un genérico deja al agente sin saber por
  // qué no puede seguir.
  if (error) return { error: error.message }

  const r = (data ?? {}) as {
    prospecto_id?: string
    contacto_id?: string
    creado?: boolean
    motivo?: string
  }

  if (!r.prospecto_id) return { error: "La promoción no devolvió ningún prospecto" }

  // Y de aquí sube a Inmovilla, FUERA de la transacción y después de que el
  // prospecto ya exista. Si su API está caída o rechaza la ficha, el prospecto
  // se queda creado igual: el fallo se guarda en `inmovilla_error` y su ficha
  // ofrece reintentar. Al revés —subir primero, o dentro— un corte de red
  // dejaría el CRM sin el prospecto y a Inmovilla con la propiedad.
  //
  // Se espera a que termine en vez de dispararlo y olvidarse: en un servidor
  // que apaga la función al contestar, lo que no se espera no se manda. Es
  // alrededor de un segundo.
  let inmovilla: { ref?: string; error?: string } = {}
  if (r.creado !== false) {
    inmovilla = await crearProspectoEnInmovilla(r.prospecto_id)
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : "No se ha podido hablar con Inmovilla" }))
  }

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  revalidatePath("/contactos")
  revalidarProspectos(r.prospecto_id)

  return {
    ok: true,
    prospectoId: r.prospecto_id,
    contactoId: r.contacto_id,
    yaExistia: r.creado === false,
    inmovillaRef: inmovilla.ref,
    inmovillaError: inmovilla.error,
  }
}

// ---------------------------------------------------------------------------
// LECTURA
// ---------------------------------------------------------------------------

/**
 * Las tres claves ajenas a `perfiles` se nombran con su constraint.
 *
 * `prospectos` apunta a `perfiles` por captado_por, agente_id y creado_por: sin
 * decir cuál, PostgREST no sabe por dónde incrustar y devuelve un error de
 * relación ambigua. Los nombres son los que pone Postgres solo al declarar la
 * columna con REFERENCES (`<tabla>_<columna>_fkey`), igual que ya hace la lista
 * de captaciones.
 */
const COLUMNAS_LISTA = `
  id, estado, motivo_perdida, perdido_en,
  direccion, barrio, ciudad, tipo_inmueble, operacion,
  precio, precio_salida, metros, habitaciones, banos, planta,
  tiene_ascensor, estado_inmueble, imagenes, url_anuncio,
  exclusiva, honorarios_pct, propiedad_ref, captada_en,
  inmovilla_cod_ofer, inmovilla_subido_en, inmovilla_error,
  captacion_id, contacto_id, agente_id, captado_por,
  atendido_en, proximo_toque, proximo_motivo, created_at, updated_at,
  contacto:leads!prospectos_contacto_id_fkey(id, nombre, apellidos, telefono, email),
  agente:perfiles!prospectos_agente_id_fkey(id, nombre, apellidos, avatar_url),
  captador:perfiles!prospectos_captado_por_fkey(id, nombre, apellidos, avatar_url)
`

/**
 * Una página de la lista de prospectos, con el total de verdad.
 *
 * El total sale del `count` exacto que calcula la base de datos, no de contar
 * las filas cargadas: PostgREST corta en 1.000 filas con un 200 OK y sin decir
 * nada, así que contar sobre `data` daría el tamaño de la página disfrazado de
 * total. Mismo planteamiento que `getCaptaciones`.
 *
 * El rol se resuelve aquí, en el servidor: esto está exportado desde un fichero
 * "use server" y cualquiera puede llamarlo desde el navegador.
 */
export async function getProspectos({
  estado,
  search,
  pagina = 1,
  porPagina = 50,
}: {
  /** Valor del catálogo `estado_prospecto`. "todos" o vacío no filtra. */
  estado?: string
  search?: string
  /** Empieza en 1. */
  pagina?: number
  porPagina?: number
} = {}): Promise<{ filas: Record<string, unknown>[]; total: number }> {
  const { userId, isAdmin } = await sesionActual()
  const supabase = await createAdminClient()

  let query = supabase
    .from("prospectos")
    .select(COLUMNAS_LISTA, { count: "exact" })
    .order("updated_at", { ascending: false })

  // Un agente ve su cartera. Quién eres se decide aquí y no se acepta por
  // parámetro: un `isAdmin: true` colado en el payload habría bastado para leer
  // la tabla entera.
  if (!isAdmin) query = query.eq("agente_id", userId)

  // El valor viene del navegador, pero `.eq()` lo manda parametrizado: uno que
  // no esté en el catálogo devuelve cero filas, que es lo correcto. La lista de
  // estados NO se escribe aquí: la conoce el catálogo `estado_prospecto`.
  if (estado && estado !== "todos") query = query.eq("estado", estado)

  if (search) {
    // Las comas y los paréntesis son la sintaxis del propio `.or()`: sin
    // quitarlos, teclear "Gran Vía, 4" rompe la consulta entera.
    const q = search.replace(/[,()\\]/g, " ").trim()
    // Sólo columnas del prospecto. Buscar además por el nombre del propietario
    // exigiría un `!inner` sobre `leads`, y eso ANDea con el resto en vez de
    // sumarse al OR: dejaría fuera los prospectos cuya dirección sí encaja.
    // Pendiente de resolver con una columna de búsqueda en la propia tabla.
    if (q) query = query.or(`direccion.ilike.%${q}%,barrio.ilike.%${q}%,propiedad_ref.ilike.%${q}%`)
  }

  // Página y tamaño llegan del navegador: sin acotarlos, un `porPagina` de
  // 100.000 volvería a pedir más filas de las que PostgREST devuelve.
  const tamano = Math.min(200, Math.max(1, Math.floor(porPagina) || 50))
  const desde = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamano

  const { data, error, count } = await query.range(desde, desde + tamano - 1)
  if (error) throw new Error(error.message)
  return { filas: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0 }
}

/**
 * Los totales de cada pastilla, contados en la base de datos.
 *
 * `head: true`: viajan los contadores y no las filas. Y un contador que falla se
 * devuelve como null y no como 0, porque un 0 se lee como "no hay ninguno", que
 * es justo la mentira que esto viene a quitar de en medio: quien pinte esto
 * tiene que saltarse los null en vez de escribir un cero.
 *
 * La lista de estados sale del catálogo: un estado nuevo encendido desde
 * /configuracion/catalogos se cuenta solo, sin tocar código.
 */
export async function getTotalesProspectos(): Promise<{
  total: number | null
  porEstado: Record<string, number | null>
}> {
  const { userId, isAdmin } = await sesionActual()
  const supabase = await createAdminClient()

  const { data: cat } = await supabase
    .from("catalogos")
    .select("valor")
    .eq("tipo", "estado_prospecto")
    .eq("activo", true)
    .order("orden")

  const estados = (cat ?? []).map((c) => c.valor as string)

  const base = () => {
    const q = supabase.from("prospectos").select("id", { count: "exact", head: true })
    return isAdmin ? q : q.eq("agente_id", userId)
  }

  const [todos, ...cuentas] = await Promise.all([
    base(),
    ...estados.map((e) => base().eq("estado", e)),
  ])

  const n = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0)

  const porEstado: Record<string, number | null> = {}
  estados.forEach((e, i) => { porEstado[e] = n(cuentas[i]) })

  return { total: n(todos), porEstado }
}

/** La ficha entera de un prospecto. `null` si no existe o no es de quien pregunta. */
export async function getProspecto(id: string): Promise<Record<string, unknown> | null> {
  const { userId, isAdmin } = await sesionActual()
  if (!UUID.test(id)) return null

  const supabase = await createAdminClient()

  let query = supabase
    .from("prospectos")
    .select(`${COLUMNAS_LISTA}, descripcion, creado_por`)
    .eq("id", id)
  if (!isAdmin) query = query.eq("agente_id", userId)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as unknown as Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// ESCRITURA
// ---------------------------------------------------------------------------

export interface CamposProspecto {
  direccion?: string | null
  barrio?: string | null
  ciudad?: string | null
  tipo_inmueble?: string | null
  operacion?: string | null
  precio?: number | null
  precio_salida?: number | null
  metros?: number | null
  habitaciones?: number | null
  banos?: number | null
  planta?: string | null
  tiene_ascensor?: boolean | null
  estado_inmueble?: string | null
  descripcion?: string | null
  url_anuncio?: string | null
  exclusiva?: boolean | null
  honorarios_pct?: number | null
  propiedad_ref?: string | null
  /** ISO. El día que el piso se firma. */
  captada_en?: string | null
  imagenes?: string[] | null
  /** Traspaso: sólo un administrador. */
  agente_id?: string | null
}

type Limpiador = (v: unknown) => unknown

const texto: Limpiador = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === "" ? null : s
}
const numero: Limpiador = (v) => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const entero: Limpiador = (v) => {
  const n = numero(v)
  return typeof n === "number" ? Math.round(n) : null
}
const booleano: Limpiador = (v) => (v === null || v === undefined ? null : Boolean(v))
const lista: Limpiador = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : null

/**
 * Lo que la ficha deja editar, campo por campo.
 *
 * Es una lista blanca y no un `{...campos}` a propósito: esto se exporta desde
 * un fichero "use server", así que el objeto llega del navegador y un spread
 * dejaría escribir `estado`, `captado_por`, `contacto_id` o `captacion_id` a
 * quien montara la petición a mano. El embudo se mueve por
 * `cambiarEstadoProspecto` y `captado_por` no se pisa nunca: eso es lo que
 * sostiene el "lo trajo Raúl".
 */
const EDITABLES: Record<string, Limpiador> = {
  direccion: texto,
  barrio: texto,
  ciudad: texto,
  tipo_inmueble: texto,
  operacion: texto,
  precio: numero,
  precio_salida: numero,
  metros: entero,
  habitaciones: entero,
  banos: entero,
  planta: texto,
  tiene_ascensor: booleano,
  estado_inmueble: texto,
  descripcion: texto,
  url_anuncio: texto,
  exclusiva: booleano,
  honorarios_pct: numero,
  propiedad_ref: texto,
  captada_en: texto,
  imagenes: lista,
}

/**
 * Editar la ficha del prospecto. Es la copia, no el anuncio: aquí sí se puede.
 *
 * `updated_at` se escribe a mano porque la tabla no tiene trigger que lo toque,
 * y la lista se ordena por esa columna: sin esto, un prospecto recién editado se
 * quedaría en el mismo sitio de la lista.
 */
export async function actualizarProspecto(
  id: string,
  campos: CamposProspecto,
): Promise<{ ok?: true; error?: string }> {
  const { userId, isAdmin } = await sesionActual()
  if (!UUID.test(id)) return { error: "Ese prospecto no existe" }

  const entrada = (campos ?? {}) as Record<string, unknown>
  const parche: Record<string, unknown> = {}
  for (const [campo, limpiar] of Object.entries(EDITABLES)) {
    // `undefined` es "no lo mando", no "bórralo": los campos de `CamposProspecto`
    // son opcionales, y un formulario que arme el objeto con
    // `{ precio: hayPrecio ? p : undefined }` lleva la clave puesta. Mirando sólo
    // si la clave existe, esa ficha se guardaría con el precio —o las imágenes—
    // en nulo sin que nadie lo haya pedido. Para vaciar un campo se manda `null`,
    // que sí pasa.
    if (entrada[campo] !== undefined) parche[campo] = limpiar(entrada[campo])
  }

  // El traspaso no es una edición de la ficha: es una decisión de quién trabaja
  // el trato. Se dice en voz alta en vez de ignorarlo en silencio, que dejaría
  // al administrador creyendo que ha guardado algo. Y se mira el valor, no la
  // clave, por lo mismo que arriba: con un `agente_id: undefined` en el objeto,
  // un agente se comería un "sólo un administrador traspasa" sin haber pedido
  // ningún traspaso y perdería sus correcciones.
  if (entrada.agente_id !== undefined) {
    if (!isAdmin) return { error: "Sólo un administrador traspasa un prospecto" }
    const destino = entrada.agente_id
    if (destino !== null && (typeof destino !== "string" || !UUID.test(destino))) {
      return { error: "Ese agente no existe" }
    }
    parche.agente_id = destino
  }

  if (Object.keys(parche).length === 0) return { error: "No hay nada que guardar" }

  const supabase = await createAdminClient()

  // Un agente edita lo suyo. Se comprueba en el UPDATE y no antes: así no hay
  // hueco entre la comprobación y la escritura.
  let query = supabase
    .from("prospectos")
    .update({ ...parche, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (!isAdmin) query = query.eq("agente_id", userId)

  const { data, error } = await query.select("id").maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Ese prospecto ya no existe o no es tuyo" }

  revalidarProspectos(id)
  return { ok: true }
}

/**
 * Mover el embudo del prospecto dejando rastro.
 *
 * Al cerrar en Perdido se exige motivo, igual que en `cambiarEstadoLead` y por
 * lo mismo: hay 135 leads perdidos sin uno solo, y por eso hoy no se puede saber
 * si se pierden por precio o porque nadie los llamó. El valor "Perdido" aparece
 * escrito porque es el único estado con consecuencias (motivo y sello); el resto
 * de la lista sigue saliendo del catálogo y la valida el trigger de la 012, que
 * además devuelve un mensaje que se puede enseñar tal cual.
 */
export async function cambiarEstadoProspecto(
  id: string,
  estado: string,
  motivoPerdida?: string | null,
): Promise<{ ok?: true; error?: string }> {
  const { userId, isAdmin } = await sesionActual()
  if (!userId) return { error: "Se ha cerrado la sesión: vuelve a entrar" }
  if (!UUID.test(id)) return { error: "Ese prospecto no existe" }
  if (!estado?.trim()) return { error: "Falta el estado" }

  const supabase = await createAdminClient()

  let lectura = supabase
    .from("prospectos")
    .select("id, estado, contacto_id, captacion_id, direccion, agente_id")
    .eq("id", id)
  if (!isAdmin) lectura = lectura.eq("agente_id", userId)

  const { data: antes, error: errLectura } = await lectura.maybeSingle()
  if (errLectura) return { error: errLectura.message }
  if (!antes) return { error: "Ese prospecto ya no existe o no es tuyo" }
  if (antes.estado === estado && !motivoPerdida) return { ok: true }

  const esPerdido = estado === "Perdido"
  if (esPerdido && !motivoPerdida) return { error: "Di por qué se pierde" }

  const parche: Record<string, unknown> = { estado, updated_at: new Date().toISOString() }
  if (esPerdido) {
    parche.motivo_perdida = motivoPerdida
    parche.perdido_en = new Date().toISOString()
  } else if (antes.estado === "Perdido") {
    // Se recupera: el motivo anterior deja de ser cierto.
    parche.motivo_perdida = null
    parche.perdido_en = null
  }

  // El dueño se vuelve a exigir en el propio UPDATE y no sólo en la lectura de
  // arriba: entre las dos hay un viaje, y un traspaso que caiga justo ahí dejaría
  // a quien ya no lo lleva moviendo el embudo de otro. Es el mismo criterio que
  // `actualizarProspecto`.
  let escritura = supabase.from("prospectos").update(parche).eq("id", id)
  if (!isAdmin) escritura = escritura.eq("agente_id", userId)

  const { data: escrito, error } = await escritura.select("id").maybeSingle()
  if (error) return { error: error.message }
  if (!escrito) return { error: "Ese prospecto ya no existe o no es tuyo" }

  // El rastro se apunta después y sin cortar si falla: perder la anotación es
  // molesto, perder el cambio de estado por no poder anotarlo sería absurdo.
  //
  // Se escribe directo en `interacciones` y no por `apuntar_interaccion`: esa
  // función es de la 018 y no conoce `prospecto_id`, así que la nota colgaría
  // sólo del contacto y la ficha del prospecto se quedaría sin su historia.
  const { data: nombreMotivo } = motivoPerdida
    ? await supabase.from("catalogos").select("nombre")
        .eq("tipo", "motivo_perdida").eq("valor", motivoPerdida).maybeSingle()
    : { data: null }

  await supabase.from("interacciones").insert({
    // Con el contacto puesto, el cambio también se lee desde la ficha de la
    // persona: es la misma historia mirada desde otro sitio.
    lead_id: antes.contacto_id,
    prospecto_id: id,
    tipo: "cambio_estado",
    direccion: "interna",
    canal: "crm",
    resumen: `${antes.estado ?? "—"} → ${estado}`
      + (nombreMotivo?.nombre ? ` · ${nombreMotivo.nombre}` : ""),
    agente_id: userId,
    automatica: false,
    ocurrida_en: new Date().toISOString(),
    meta: { desde: antes.estado, hasta: estado, motivo: motivoPerdida ?? null },
  })

  revalidatePath("/leads")
  revalidatePath("/contactos")
  // `v_mi_dia` deja fuera los Captado y los Perdido: cerrar un prospecto cambia
  // la lista de a quién hay que llamar hoy.
  revalidarProspectos(id)
  return { ok: true }
}
