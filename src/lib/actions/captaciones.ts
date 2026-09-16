"use server"

import { createClient, createAdminClient, createServiceClient } from "@/lib/supabase/server"
import { admiteAdmin, SIN_PERMISO, sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { opcionesDe } from "@/lib/catalogos"
import type { EstadoAgenda } from "@/types/captaciones"

export async function getCaptacionByTelefono(telefono: string) {
  const supabase = await createAdminClient()
  const digits = telefono.replace(/\D/g, "")
  const sufijo = digits.slice(-9)
  const { data } = await supabase
    .from("captaciones")
    .select("id, nombre, telefono, calle, barrio, precio, metros, habitaciones, imagen_url, url, raw_data")
    .ilike("telefono", `%${sufijo}`)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  return data as ({ id: number; nombre: string | null; telefono: string | null; calle: string | null; barrio: string | null; precio: number | null; metros: number | null; habitaciones: number | null; imagen_url: string | null; url: string | null; raw_data: Record<string, unknown> | null } | null)
}

/**
 * LAS DOS COLUMNAS DE FECHA POR LAS QUE SE PUEDE CORTAR LA LISTA.
 *
 * Son dos y no una porque las dos tarjetas de la portada NO CUENTAN LO MISMO, y
 * cada enlace tiene que traer aquí SU pregunta:
 *
 *   · `created_at` — CUÁNDO ENTRÓ EL ANUNCIO. Es lo que cuenta la tarjeta del
 *     agente ("Scraper · mis captaciones"), que son sus fichas asignadas.
 *   · `senal_en`   — CUÁNDO DIJO QUE SÍ EL PROPIETARIO. Es lo que cuenta la
 *     tarjeta del administrador ("Scraper · con señal"), que no mide anuncios
 *     sino gente que ha levantado la mano.
 *
 * Medido el día de escribir esto: 13 captaciones con señal en los últimos 7
 * días contra 98 creadas en los últimos 7 días. O sea que cortar por la columna
 * equivocada no es un matiz: es que la tarjeta diga 13 y salgan 98.
 *
 * La lista vive aquí y no en la pantalla porque esta función está exportada
 * desde un fichero "use server": la puede llamar cualquiera desde el navegador
 * con el nombre de columna que se invente, y `.gte()` con una columna que no
 * existe es un 400 de PostgREST disfrazado de "no tienes captaciones".
 */
const CAMPOS_FECHA = ["created_at", "senal_en"] as const
type CampoFecha = (typeof CAMPOS_FECHA)[number]

/** El corte de fecha tal y como viaja: la columna y desde cuándo, juntas. */
type CorteFecha = { campo: CampoFecha; desde: string }

/**
 * Pone el corte de fecha a una consulta de captaciones, si es que hay corte y
 * si es que se puede creer.
 *
 * Va en UNA función porque la usan los dos sitios que cuentan —la página de la
 * lista y los contadores de las pastillas— y escrita dos veces se irían
 * separando: el día que alguien cambiara aquí el criterio de la señal, la
 * pastilla diría un número y la lista enseñaría otro.
 *
 * Lo que no cuadra NO filtra, en vez de reventar: una columna inventada o una
 * fecha ilegible dejan la consulta como estaba y sale la lista entera, que es
 * menos malo que una pantalla vacía sin explicación.
 *
 * Y con `senal_en` se exige además `senal IS NOT NULL`: la pregunta de la
 * tarjeta del administrador es "quién se interesó", y a quien se le quitó la
 * señal después —contestó que no— ya no se interesa, aunque conserve la fecha
 * en que un día lo hizo. Es el mismo criterio con el que cuenta esa tarjeta.
 *
 * Los dos métodos se declaran en una interfaz aparte y se entra y se sale con
 * una conversión, en vez de atar el genérico a ellos: los constructores de
 * supabase se tipan a sí mismos de forma recursiva y TypeScript se rinde con
 * "Type instantiation is excessively deep" (TS2589). Devolviendo el tipo de
 * entrada, quien llama conserva su `.range()`, su `.or()` y su `count`. La
 * conversión es cierta: los dos métodos devuelven el MISMO constructor.
 */
interface FiltrablePorFecha {
  gte(columna: string, valor: string): FiltrablePorFecha
  not(columna: string, operador: "is", valor: null): FiltrablePorFecha
}

function conCorte<Q>(query: Q, corte: CorteFecha | undefined): Q {
  if (!corte) return query
  if (!(CAMPOS_FECHA as readonly string[]).includes(corte.campo)) return query
  const ms = new Date(corte.desde).getTime()
  if (Number.isNaN(ms)) return query
  const q = (query as unknown as FiltrablePorFecha)
    .gte(corte.campo, new Date(ms).toISOString())
  return (corte.campo === "senal_en" ? q.not("senal", "is", null) : q) as unknown as Q
}

/**
 * Una página de la lista de captaciones, con el total de verdad.
 *
 * Antes acababa en `.limit(500)` y devolvía el array pelado. Con 1.031 activas
 * eso son 531 que no existían para la pantalla, y nada en la respuesta lo decía:
 * PostgREST recorta con un 200 OK y sin aviso. Así que aquí se pide sólo el
 * tramo que se ve, con `.range()`, y el total se lee del `count` exacto que
 * PostgREST calcula en la base de datos y devuelve en `Content-Range`. Contarlo
 * sobre `data` daría el tamaño de la página y volveríamos al mismo engaño.
 *
 * El rol ya no llega por parámetro. Al paginar desde el navegador esta función
 * pasa a ser una acción invocable por el cliente, y un `isAdmin: true` colado en
 * el payload habría bastado para leer la tabla entera saltándose RLS: quién eres
 * se decide aquí, en el servidor.
 */
export async function getCaptaciones({
  filtro,
  search,
  corte,
  pagina = 1,
  // Replica POR_PAGINA de shared/paginador. No se importa de allí porque ese
  // módulo es "use client" y un módulo de servidor no puede leer sus constantes.
  porPagina = 50,
}: {
  filtro?: string
  search?: string
  /**
   * EL CORTE DE FECHA, cuando se llega pulsando una tarjeta de la portada.
   *
   * Un solo parámetro con la columna DENTRO, y no dos sueltos (`desde` +
   * `campoFecha`), porque los dos datos no significan nada por separado: una
   * fecha sin columna no se sabe contra qué comparar y una columna sin fecha no
   * filtra nada. Con dos parámetros opcionales, `{ campoFecha: "senal_en" }` a
   * secas es una llamada legal que no hace nada —y lo que no hace nada en una
   * lista es enseñar 759 filas donde la tarjeta prometía 13—. Juntos, esa
   * combinación no se puede ni escribir.
   */
  corte?: CorteFecha
  /** Empieza en 1. */
  pagina?: number
  porPagina?: number
} = {}) {
  const { userId, isAdmin } = await sesionActual()

  // Admins usan service role para bypassar RLS y ver todas las captaciones
  const supabase = isAdmin ? await createAdminClient() : await createClient()

  let query = supabase
    .from("captaciones")
    .select(`
      id, created_at, nombre, telefono, precio, precio_m2,
      barrio, calle, metros, habitaciones, banos, planta,
      tiene_ascensor, estado, estado_crm, estado_whatsapp, senal, activo, imagen_url, imagenes,
      agente_id, fecha_agenda, recordatorio_fecha, notas_agenda, estado_agenda,
      operacion:raw_data->>operation,
      agente:perfiles!captaciones_agente_id_fkey(id, nombre, apellidos, avatar_url)
    `, { count: "exact" })
    .eq("activo", true)
    .order("created_at", { ascending: false })

  if (!isAdmin) {
    query = query.eq("agente_id", userId)
  }

  // El corte de fecha de la tarjeta que se ha pulsado. Lo valida `conCorte`, que
  // es también quien lo pone en los contadores de las pastillas: los dos tienen
  // que estar mirando las mismas filas.
  query = conCorte(query, corte)

  if (search) {
    // Las comas y los paréntesis son la sintaxis del propio `.or()`: sin
    // quitarlos, teclear "Gran Vía, 4" en el buscador rompe la consulta entera.
    const q = search.replace(/[,()\\]/g, " ").trim()
    if (q) query = query.or(`calle.ilike.%${q}%,barrio.ilike.%${q}%,nombre.ilike.%${q}%`)
  }

  // El filtro sigue siendo el `valor` de una fila del catálogo, sin tabla de
  // equivalencias de por medio. Lo que cambió en la 027 es que ya no hay una
  // sola pregunta, hay dos, y cada una vive en su columna:
  //
  //   estado_whatsapp -> ¿ha contestado?        Enviado · Respondido · …
  //   senal           -> ¿qué entiende la IA?   interesado · quiere_llamada
  //
  // De qué lista es el valor NO se decide con una lista escrita aquí —eso es
  // justo lo que obligaba a desplegar por cada valor nuevo—: lo dice el
  // catálogo, que es quien conoce el `tipo` de cada valor. Así, una señal nueva
  // creada desde /configuracion/catalogos filtra sola.
  //
  // Si un valor llegara a estar en las dos listas manda la señal: es la
  // pastilla que mira el comercial, y es la que no puede acabar filtrando por
  // otra columna sin que nadie lo note.
  //
  // El catálogo sólo se lee cuando hay filtro: la vista por defecto ("todas")
  // no paga una consulta de más por esto.
  //
  // El valor viene del navegador, pero `.eq()` lo manda parametrizado y uno que
  // no esté en ninguna de las dos listas devuelve cero filas, que es lo correcto.
  if (filtro && filtro !== "todas") {
    const catalogos = await getCatalogosActivos()
    const esSenal = opcionesDe(catalogos, "senal_interes").some((c) => c.valor === filtro)
    query = esSenal
      ? query.eq("senal", filtro)
      : query.eq("estado_whatsapp", filtro)
  }

  // Página y tamaño llegan del navegador: sin acotarlos, un `porPagina` de
  // 100.000 volvería a pedir más filas de las que PostgREST devuelve, que es
  // exactamente el corte silencioso que esto viene a quitar.
  const tamano = Math.min(200, Math.max(1, Math.floor(porPagina) || 50))
  const desde = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamano

  const { data, error, count } = await query.range(desde, desde + tamano - 1)
  if (error) throw new Error(error.message)
  return { filas: data ?? [], total: count ?? 0 }
}

/**
 * Los totales de verdad.
 *
 * `getCaptaciones` devuelve como mucho 500 filas, que es lo sensato para pintar
 * una lista. Pero contar sobre lo que devuelve da 500 aunque haya 1.031, y la
 * cabecera lleva tiempo diciendo un número que no es. Aquí se cuenta en la base
 * de datos con `head: true`: no viaja ni una fila, sólo la cifra.
 */
/**
 * Los totales de cada pastilla de la lista de captaciones.
 *
 * Cuentan por `estado_whatsapp` —¿ha contestado?— y, desde la 027, también por
 * `senal` —¿qué ha entendido la IA de lo que contestó?—, que son dos preguntas
 * distintas y ya no caben en una sola columna. Antes contaban quién la tenía
 * asignada y cómo estaba la agenda — "795 sin asignar" no te dice nada de la
 * captación, y ocupaba el sitio de lo que sí importa.
 *
 * `conSenal` va aparte de `porSenal` a propósito: el subtítulo enseña cuántos
 * propietarios han mostrado interés, y eso es "tiene señal, la que sea". Sumar
 * las de abajo daría el mismo número hoy, pero dejaría fuera cualquier señal
 * que el administrador añada mañana y cualquier fila con una señal archivada.
 *
 * Son `head: true`, así que viajan los contadores y no las filas: da igual que
 * la tabla crezca a 50.000.
 *
 * El rol se resuelve aquí dentro y ya no llega por parámetro. Esto está
 * exportado desde un fichero "use server", así que cualquiera puede llamarlo
 * desde el navegador: con `soloAgenteId` a elección de quien llamara, un agente
 * podía pedir los totales de otro.
 *
 * ARREGLADO EN REVISIÓN: el párrafo del corte llegó como un SEGUNDO bloque
 * pegado justo debajo de éste, y dos bloques seguidos no son dos párrafos: el
 * editor sólo enseña el que toca la declaración, así que todo lo de arriba
 * —incluida la nota de por qué el rol ya no llega por parámetro— desaparecía
 * del tooltip de quien fuera a llamar esta función, que es justo quien tiene
 * que leerla. Va todo en un bloque.
 *
 * `corte` es el MISMO que se le pasa a `getCaptaciones`, y por el mismo motivo.
 *
 * Si la lista se corta por fecha y estos contadores no, la pantalla se
 * contradice sola: la cabecera diría "759 propiedades · 97 interesados", la
 * pastilla "Todas 759" y debajo saldrían trece fichas. El número de la tarjeta
 * que se acaba de pulsar es el único que importa, y aquí tienen que salir todos
 * de las mismas filas. Quitar el corte es pulsar la chapa, que vuelve a esta
 * pantalla sin parámetros y lo cuenta todo otra vez.
 */
export async function getTotalesCaptaciones({ corte }: { corte?: CorteFecha } = {}) {
  const { userId, isAdmin } = await sesionActual()
  const supabase = isAdmin ? await createAdminClient() : await createClient()

  // La lista de estados sale del catálogo, no de aquí. Si mañana se crea un
  // estado nuevo desde /configuracion/catalogos, esta función lo cuenta sola y
  // le sale su pastilla sin tocar código ni desplegar.
  const catalogos = await getCatalogosActivos()
  const estados = opcionesDe(catalogos, "estado_whatsapp").map((c) => c.valor)
  const senales = opcionesDe(catalogos, "senal_interes").map((c) => c.valor)

  const base = () => {
    let q = supabase.from("captaciones").select("id", { count: "exact", head: true }).eq("activo", true)
    if (!isAdmin) q = q.eq("agente_id", userId)
    // El corte va en `base()` y no en cada contador: así lo llevan los doce a la
    // vez y no hay ninguno que se quede contando la tabla entera.
    return conCorte(q, corte)
  }

  // `head: true`, así que viajan los contadores y no las filas: da igual que la
  // tabla crezca a 50.000. Son una decena de consultas en paralelo, no una por
  // fila.
  const [todas, conSenal, ...cuentas] = await Promise.all([
    base(),
    base().not("senal", "is", null),
    ...estados.map((e) => base().eq("estado_whatsapp", e)),
    ...senales.map((s) => base().eq("senal", s)),
  ])

  // Un contador que falla se devuelve como null y no como 0: un 0 se lee como
  // "no hay ninguna", que es justo la mentira que estamos quitando de en medio.
  const n = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0)

  // `cuentas` llega en el mismo orden en que se pidió: primero los estados y
  // después las señales. Se reparte por posición y no por nombre porque los dos
  // catálogos podrían llegar a compartir un `valor`.
  const porEstado: Record<string, number | null> = {}
  estados.forEach((e, i) => { porEstado[e] = n(cuentas[i]) })

  const porSenal: Record<string, number | null> = {}
  senales.forEach((sv, i) => { porSenal[sv] = n(cuentas[estados.length + i]) })

  return { total: n(todas) ?? 0, porEstado, porSenal, conSenal: n(conSenal) }
}

export async function getCaptacion(id: number) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select(`
      *,
      agente:perfiles!captaciones_agente_id_fkey(id, nombre, apellidos, avatar_url)
    `)
    .eq("id", id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getHistorial(captacionId: number) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("historial_cambios")
    .select("*")
    .eq("captacion_id", captacionId)
    .order("fecha", { ascending: false })
    .limit(50)
  return data ?? []
}

export async function getAgentes() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("perfiles")
    .select("id, nombre, apellidos, avatar_url, rol")
    .order("nombre")
  return data ?? []
}

/**
 * Asignar o traspasar el agente de una captación.
 *
 * Las cuatro columnas de agenda (fecha_agenda, recordatorio_fecha,
 * notas_agenda, estado_agenda) siguen aceptándose para no romper a quien todavía
 * las mande, pero ya no las escribe nadie: desde la migración 021 las citas y
 * los recordatorios son filas de `agenda` y las notas, filas de
 * `interacciones`. Se pueden borrar de la tabla cuando esto lleve unos días.
 */
export async function asignarAgenda(
  captacionId: number,
  payload: {
    agente_id: string | null
    fecha_agenda?: string | null
    recordatorio_fecha?: string | null
    notas_agenda?: string | null
    estado_agenda?: EstadoAgenda
  }
) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({
      agente_id: payload.agente_id,
      asignado_en: payload.agente_id ? new Date().toISOString() : null,
      visto_en: null,
    })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  // El lead espejo hereda el agente SOLO, con el trigger de la migración 026.
  // Aquí no se toca a propósito: a una captación se le pone agente desde cinco
  // sitios y tres de ellos no pasan por este código (el trigger automático al
  // mostrar interés, el botón de repartir y el de "Atendido"). Hacerlo también
  // aquí serían dos reglas para lo mismo, y dos reglas para lo mismo siempre
  // acaban discrepando.

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return { success: true }
}

export async function actualizarEstadoAgenda(captacionId: number, estado: EstadoAgenda) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ estado_agenda: estado })
    .eq("id", captacionId)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Formato canónico del teléfono en todo el captador: 34XXXXXXXXX, solo dígitos.
 *
 * Es el que produce el scraper (`telefonoES`), el que deja la migración 003 en el
 * histórico y el que exige la cola de WhatsApp con su filtro `telefono=like.34*`.
 * Devuelve null si no es un fijo/móvil español, para no guardar un número que la
 * cola intentaría enviar y Evolution rechazaría.
 */
function normalizar(telefono: string | null): string | null {
  let d = String(telefono ?? "").replace(/\D/g, "")
  if (d.startsWith("00")) d = d.slice(2)
  if (d.length === 9) d = "34" + d
  return /^34[6-9]\d{8}$/.test(d) ? d : null
}

function phoneToJid(phone: string): string {
  const clean = normalizar(phone) ?? phone.replace(/[^\d]/g, "")
  return `${clean}@s.whatsapp.net`
}

/**
 * Garantiza que la captación tiene su lead espejo, creándolo si hace falta.
 *
 * El contacto manual no creaba ninguno, y el clasificador de respuestas (workflow 5)
 * actualiza el lead filtrando por captacion_id: sin fila, ese PATCH afectaba a cero
 * filas, PostgREST devolvía 204 y el propietario interesado no aparecía en /leads.
 */
async function asegurarLead(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  captacionId: number,
  nombre: string | null,
  telefono: string | null,
) {
  const { data: existente } = await supabase
    .from("leads")
    .select("id, estado")
    .eq("captacion_id", captacionId)
    .maybeSingle()

  if (existente) {
    if (existente.estado === "Nuevo") {
      await supabase.from("leads").update({ estado: "Contactado" }).eq("id", existente.id)
    }
    return
  }

  await supabase.from("leads").insert({
    nombre: nombre || "Propietario",
    telefono,
    fuente: "Captaciones",
    estado: "Contactado",
    captacion_id: captacionId,
    notas: "Contacto manual desde el panel de captaciones",
  })
}

function hasValidPhone(telefono: string | null): boolean {
  if (!telefono) return false
  const lower = telefono.toLowerCase()
  return !lower.includes("no disponible") && !lower.includes("privado") && telefono.trim() !== ""
}

function generateDefaultMessage(cap: { nombre: string | null; calle: string | null; barrio: string | null; precio: number | null }): string {
  const nombre = cap.nombre || "propietario"
  const calle = cap.calle || "su propiedad"
  const barrio = cap.barrio || "Valencia"
  const precio = cap.precio ? `${cap.precio.toLocaleString("es-ES")}€` : ""
  return `Hola ${nombre}, 👋\n\nLe contacto desde *Grupo Hogares*, empresa de gestión inmobiliaria en Valencia.\n\nHe visto su anuncio del piso en *${calle}*, ${barrio}${precio ? ` por ${precio}` : ""}.\n\nEstamos especializados en ayudar a propietarios a vender su vivienda de forma rápida y al mejor precio. ¿Tendría unos minutos para comentarle cómo podemos ayudarle?\n\nUn saludo 🏠`
}

export async function generarMensajeIA(captacionId: number): Promise<string> {
  const supabase = await createAdminClient()
  const { data: cap } = await supabase
    .from("captaciones")
    .select("nombre, calle, barrio, precio, url")
    .eq("id", captacionId)
    .single()

  if (!cap) return ""

  // Obtener nombre del agente logueado
  const { data: { user } } = await supabase.auth.getUser()
  let agenteName = "Josep"
  if (user) {
    const { data: perfil } = await supabase.from("perfiles").select("nombre, rol").eq("id", user.id).single()
    if (perfil?.rol === "Admin") agenteName = "Josep"
    else if (perfil?.nombre) agenteName = perfil.nombre
  }

  const n8nUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_IA_LEAD_GEN
  if (!n8nUrl) return generateDefaultMessage(cap)

  try {
    const res = await fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // El webhook de n8n exige esta cabecera desde el captador v2.
        ...(process.env.WEBHOOK_SECRET ? { "x-webhook-secret": process.env.WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({ captacion_id: captacionId, agent: agenteName }),
    })
    if (res.ok) {
      const raw = await res.text()
      try {
        const data = JSON.parse(raw)
        const msg = data.message ?? data.data?.message ?? (typeof data.data === "string" ? JSON.parse(data.data)?.message : null)
        if (msg) return msg
      } catch {}
    }
  } catch {}

  return generateDefaultMessage(cap)
}

export async function contactarCaptacion(captacionId: number, mensaje: string) {
  const supabase = await createAdminClient()

  const { data: cap } = await supabase
    .from("captaciones")
    .select("telefono, nombre")
    .eq("id", captacionId)
    .single()

  if (!cap?.telefono || !hasValidPhone(cap.telefono)) {
    return { error: "Esta captación no tiene teléfono disponible" }
  }

  const EVO_URL = process.env.EVO_API_URL
  const EVO_KEY = process.env.EVO_API_KEY
  const EVO_INSTANCE = process.env.EVO_INSTANCE
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) return { error: "Evolution API no configurada" }

  const jid = phoneToJid(cap.telefono)

  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({ number: jid, text: mensaje }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { error: `Evolution API: ${err}` }
  }

  // Actualizar estado captación.
  // contacto_lock_en saca la captación de la cola automática (si no, el captador
  // volvería a escribirle) y ultimo_contacto_en la hace contar en el tope diario
  // de WhatsApp, para que los envíos manuales y los automáticos compartan cupo.
  const ahora = new Date().toISOString()
  await supabase
    .from("captaciones")
    .update({
      estado_whatsapp: "Enviado",
      estado_crm: "Contactado",
      contacto_lock_en: ahora,
      ultimo_contacto_en: ahora,
    })
    .eq("id", captacionId)

  await asegurarLead(supabase, captacionId, cap.nombre, cap.telefono)
  revalidatePath("/leads")

  // Notificar n8n para activar modo humano
  const n8nWebhook = process.env.NEXT_PUBLIC_N8N_WEBHOOK_WHATSAPP_BOT
  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: EVO_INSTANCE,
        data: {
          key: { remoteJid: jid, fromMe: true, id: `CRM_${Date.now()}` },
          pushName: "Agente",
          message: { conversation: mensaje },
          messageTimestamp: Math.floor(Date.now() / 1000),
          source: "crm",
        },
        apikey: EVO_KEY,
      }),
    }).catch(() => {})
  }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: null,
    valor_nuevo: "Enviado",
  })

  revalidatePath("/captaciones")
  return { success: true, jid }
}

export async function contactarCaptacionConTelefono(captacionId: number, telefono: string, mensaje: string) {
  const supabase = await createAdminClient()

  // Se guarda normalizado, no como lo teclee el agente: si no, el clasificador de
  // respuestas (que busca por los últimos 9 dígitos) no encuentra la captación cuando
  // el propietario contesta.
  const jid = normalizar(telefono)
  if (!jid) return { error: "El teléfono no parece un número español válido" }

  const EVO_URL = process.env.EVO_API_URL
  const EVO_KEY = process.env.EVO_API_KEY
  const EVO_INSTANCE = process.env.EVO_INSTANCE
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) return { error: "Evolution API no configurada" }

  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({ number: jid, text: mensaje }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { error: `Evolution API: ${err}` }
  }

  // Guardar teléfono + actualizar estados (ver nota en contactarCaptacion)
  const ahora = new Date().toISOString()
  const { data: actualizada } = await supabase
    .from("captaciones")
    .update({
      telefono: jid,
      estado_whatsapp: "Enviado",
      estado_crm: "Contactado",
      contacto_lock_en: ahora,
      ultimo_contacto_en: ahora,
    })
    .eq("id", captacionId)
    .select("nombre")
    .maybeSingle()

  await asegurarLead(supabase, captacionId, actualizada?.nombre ?? null, jid)
  revalidatePath("/leads")

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: null,
    valor_nuevo: "Enviado",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Devuelve la captación a la cola del captador automático.
 *
 * Casos típicos: quedó en "Sin WhatsApp" y el agente corrigió el teléfono, quedó en
 * "Duplicado" y se quiere escribir igualmente por el segundo anuncio, o el envío se
 * quedó a medias y la reserva sigue puesta.
 *
 * Hay que vaciar las TRES marcas: la cola exige `estado_whatsapp`, `contacto_lock_en`
 * y `ultimo_contacto_en` a null. Dejarse `ultimo_contacto_en` haría que el botón no
 * hiciera nada visible.
 */
export async function reintentarAutoContacto(captacionId: number) {
  const supabase = await createAdminClient()

  const { data: previa } = await supabase
    .from("captaciones")
    .select("estado_whatsapp")
    .eq("id", captacionId)
    .maybeSingle()

  const { error } = await supabase
    .from("captaciones")
    .update({ contacto_lock_en: null, ultimo_contacto_en: null, estado_whatsapp: null })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: previa?.estado_whatsapp ?? null,
    valor_nuevo: "En cola",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

export async function marcarRespondido(captacionId: number) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ estado_whatsapp: "Respondido" })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: "Enviado",
    valor_nuevo: "Respondido",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Dar de baja una captación: se va a la papelera.
 *
 * Y SE LE QUITA AL AGENTE QUE LA LLEVARA. Antes sólo se ponía `activo = false`,
 * y eso dejaba dos cabos sueltos:
 *
 *   · El lead espejo del propietario seguía en la lista de su agente. El trigger
 *     `bajar_agente_al_lead` (026) sólo salta cuando cambia `agente_id`, y aquí
 *     no cambiaba nada: la captación desaparecía de /captaciones y el señor
 *     seguía apareciendo en /leads como trabajo de alguien.
 *   · Al restaurarla volvía con el mismo agente puesto, aunque hubieran pasado
 *     meses y el reparto fuera ya otro.
 *
 * Ahora se suelta el agente en el mismo gesto, y el trigger de la 026 se lleva
 * también el lead espejo —tiene su rama para la retirada, con el motivo "Se le
 * quitó el agente a la captación"—. `captado_por` NO se toca: quién la trajo es
 * historia y no cambia porque la propiedad se dé de baja.
 *
 * Medido antes de escribirlo: la papelera está hoy vacía, así que esto no
 * arrastra nada hacia atrás. Es una puerta que se cierra antes de que entre nadie.
 */
export async function eliminarCaptacion(captacionId: number) {
  if (!await admiteAdmin()) return { error: SIN_PERMISO }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({
      activo: false,
      agente_id: null,
      asignado_en: null,
      asignado_por: null,
      asignacion_motivo: "Se dio de baja la captación",
    })
    .eq("id", captacionId)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  revalidatePath("/leads")
  revalidatePath("/dashboard")
  return { success: true }
}

export async function getCaptacionesEliminadas() {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select("id, created_at, nombre, telefono, precio, barrio, calle, metros, habitaciones, imagen_url, imagenes, estado_crm, estado_whatsapp")
    .eq("activo", false)
    .order("created_at", { ascending: false })
  if (error) return []
  return data ?? []
}

export async function getCaptacionesEliminadasPorAgente(agenteId: string) {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select("id, created_at, nombre, telefono, precio, barrio, calle, metros, habitaciones, imagen_url, imagenes, estado_crm, estado_whatsapp")
    .eq("activo", false)
    .eq("agente_id", agenteId)
    .order("created_at", { ascending: false })
  if (error) return []
  return data ?? []
}

export async function darDeBajaMasivo(ids: number[]) {
  if (!await admiteAdmin()) return { error: SIN_PERMISO }
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ activo: false })
    .in("id", ids)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function asignarAgentesMasivo(ids: number[], agenteId: string) {
  if (!await admiteAdmin()) return { error: SIN_PERMISO }
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({
      agente_id: agenteId,
      asignado_en: new Date().toISOString(),
      asignacion_motivo: "Asignación a mano",
      visto_en: null,
    })
    .in("id", ids)
  if (error) return { error: error.message }

  // Los leads espejo heredan el agente solos (trigger de la 026). Lo que había
  // aquí escribía `captado_por` SIN condición, así que cada reasignación masiva
  // borraba al captador de todos esos leads a la vez.

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return { success: true }
}

export async function getCaptacionesSinVer(agenteId: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("captaciones")
    .select("id, calle, barrio")
    .eq("agente_id", agenteId)
    .is("visto_en", null)
    .eq("activo", true)
  return data ?? []
}

export async function marcarCaptacionesVistas(ids: number[]) {
  if (!ids.length) return
  const supabase = await createAdminClient()
  await supabase
    .from("captaciones")
    .update({ visto_en: new Date().toISOString() })
    .in("id", ids)
}

export async function restaurarCaptaciones(ids: number[]) {
  if (!await admiteAdmin()) return { error: SIN_PERMISO }
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ activo: true })
    .in("id", ids)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function eliminarDefinitivamente(ids: number[]) {
  if (!await admiteAdmin()) return { error: SIN_PERMISO }
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  // Storage necesita service_role PURO: createAdminClient arrastra las cookies del
  // usuario y las políticas del bucket bloquean el borrado (dejaba carpetas huérfanas).
  const service = createServiceClient()

  // Limpiar Storage. Los errores no bloquean el borrado, pero sí se registran.
  const limpieza = await Promise.allSettled(
    ids.map(async (id) => {
      const { data: files, error: errList } = await service.storage
        .from("captaciones")
        .list(String(id), { limit: 1000 })
      if (errList) throw new Error(`list ${id}: ${errList.message}`)
      if (!files?.length) return 0
      const paths = files.map((f) => `${id}/${f.name}`)
      const { data: borrados, error: errDel } = await service.storage
        .from("captaciones")
        .remove(paths)
      if (errDel) throw new Error(`remove ${id}: ${errDel.message}`)
      // Sin permisos, Storage responde 200 con lista vacía: hay que detectarlo
      if (!borrados?.length) throw new Error(`remove ${id}: 0 de ${paths.length} archivos borrados (¿permisos?)`)
      return borrados.length
    })
  )

  const fallos = limpieza.filter((r) => r.status === "rejected")
  if (fallos.length) {
    console.error(
      `[eliminarDefinitivamente] Storage: ${fallos.length}/${ids.length} carpetas no se pudieron borrar.`,
      fallos.slice(0, 3).map((f) => (f as PromiseRejectedResult).reason?.message)
    )
  }

  // SOLTAR AL PROPIETARIO ANTES DE BORRAR EL ANUNCIO.
  //
  // El lead espejo —la persona— NO se borra: puede tener notas, una conversación
  // de WhatsApp y un historial que no se recuperan, y lo que se está tirando es
  // el anuncio, no al señor. Pero hay que desatarlo de la captación antes de que
  // desaparezca, y esto se hace en dos pasos porque cada uno arregla una cosa:
  //
  //   1. Quitar el agente de la CAPTACIÓN. Así el trigger de la 026 suelta
  //      también su lead espejo, con su motivo escrito. Si se borrara la
  //      captación de golpe, el trigger no llega a saltar y el contacto se queda
  //      en la lista de un agente que ya no tiene nada que trabajar.
  //   2. Vaciar el `captacion_id` del lead, que si no queda apuntando a una fila
  //      que ya no existe. Medido hoy: hay 179 leads así de borrados anteriores.
  //      Ninguno sale en la lista del día de nadie —`v_mi_dia` excluye los que
  //      tienen `captacion_id`—, así que son personas que su agente ve en /leads
  //      y a las que el CRM no le va a pedir que llame jamás.
  //
  // Los dos pasos se hacen aunque fallen: es limpieza, y si algo va mal es peor
  // dejar el anuncio sin borrar que dejar un cabo suelto que ya se sabe medir.
  await supabase
    .from("captaciones")
    .update({
      agente_id: null,
      asignado_en: null,
      asignado_por: null,
      asignacion_motivo: "Se borró la captación",
    })
    .in("id", ids)

  await supabase
    .from("leads")
    .update({
      captacion_id: null,
      asignacion_motivo: "Se borró la captación de la que venía",
    })
    .in("captacion_id", ids)

  // Borrar registros relacionados y la captación
  await supabase.from("historial_cambios").delete().in("captacion_id", ids)
  const { error } = await supabase.from("captaciones").delete().in("id", ids)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  return { success: true, storageErrores: fallos.length }
}

// Mapa estado_crm captación → estado lead
const CRM_TO_LEAD: Record<string, string> = {
  Contactado:  "Contactado",
  Interesado:  "Interesado",
  Propuesta:   "Interesado",
  Negociacion: "Interesado",
  Ganado:      "Ganado",
  Perdido:     "Perdido",
}

export async function actualizarEstadoCaptacion(captacionId: number, estadoCrm: string) {
  const supabase = await createAdminClient()

  const { data: actual } = await supabase
    .from("captaciones")
    .select("estado_crm")
    .eq("id", captacionId)
    .single()

  const { error } = await supabase
    .from("captaciones")
    .update({ estado_crm: estadoCrm })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  if (actual?.estado_crm !== estadoCrm) {
    await supabase.from("historial_cambios").insert({
      captacion_id: captacionId,
      campo: "estado_crm",
      valor_anterior: actual?.estado_crm ?? null,
      valor_nuevo: estadoCrm,
    })

    // Sincronizar lead vinculado
    const leadEstado = CRM_TO_LEAD[estadoCrm]
    if (leadEstado) {
      await supabase
        .from("leads")
        .update({ estado: leadEstado })
        .eq("captacion_id", captacionId)
    }
  }

  revalidatePath("/captaciones")
  return { success: true }
}
