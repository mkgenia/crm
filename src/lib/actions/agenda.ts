"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import {
  desdeHace, inicioDiaMadrid,
  type EntradaAgenda, type EntradaVencida, type TipoEntrada,
} from "@/lib/agenda"

/** Las columnas de una entrada, en un solo sitio: las piden tres consultas. */
const CAMPOS =
  "id, titulo, descripcion, tipo, fecha, todo_el_dia, agente_id, creado_por, completado, created_at"

/**
 * Cuántas vencidas se bajan como mucho.
 *
 * Es una lista de una columna lateral, no un listado: veinte filas ya obligan a
 * rodar. Lo que no quepa se dice en pantalla —`vencidasOcultas`—, porque un tope
 * callado es exactamente el mismo engaño que esto viene a arreglar: un número
 * arriba que abajo no aparece.
 */
const TOPE_VENCIDAS = 20

/**
 * Quién puede ver y tocar qué:
 *
 *   agente  -> sólo lo suyo, y sólo se lo puede poner a sí mismo
 *   admin   -> lo de todo el equipo, y puede apuntarle cosas a cualquiera
 *
 * La comprobación se hace aquí, en el servidor, con la sesión real. El
 * `agente_id` que llegue del cliente no se cree nunca sin comprobar antes
 * quién lo está mandando.
 */

/**
 * Las seis semanas que pinta la rejilla del mes, lo VENCIDO sin completar, y la
 * lista de personas.
 *
 * Se piden seis semanas completas y no del 1 al 31: los días de los meses
 * vecinos que se ven en las esquinas del calendario saldrían siempre vacíos.
 *
 * Lo vencido va en CONSULTA APARTE y no ensanchando esa ventana. La tarjeta "Mi
 * calendario" de la portada cuenta todo lo pendiente del agente sin mirar el
 * mes, así que decía 1 por una cita del 20/05 que el calendario —plantado en
 * septiembre— ni siquiera se bajaba: el contador prometía y la pantalla no
 * entregaba. Ensanchar la ventana lo habría tapado a costa de arrastrar meses
 * enteros de citas pasadas y ya hechas para no pintar ninguna.
 *
 * Si la tabla no existe todavía (migración 009 sin ejecutar) devuelve
 * `disponible: false` en vez de reventar: la página se enseña igual.
 */
export async function getAgendaMes(anclaISO?: string) {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const ancla = anclaISO ? new Date(anclaISO) : new Date()
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1)
  const desde = new Date(primero)
  desde.setDate(primero.getDate() - ((primero.getDay() + 6) % 7))
  const hasta = new Date(desde)
  hasta.setDate(desde.getDate() + 41)
  hasta.setHours(23, 59, 59, 999)

  /**
   * La ventana se estira hasta cubrir QUINCE días por delante cuando hoy cae
   * dentro de ella.
   *
   * La columna "Lo que viene" promete catorce días y se sirve de estas mismas
   * filas, pero la rejilla termina donde termina. Mirando septiembre acaba el
   * 11/10, así que el día 28 los últimos días de la promesa ya no se bajaban y
   * la lista los perdía SIN DECIR NADA; en un mes que empiece en domingo se
   * quedan fuera hasta nueve. Es el engaño de las vencidas otra vez en pequeño:
   * un rótulo que promete arriba y unas filas que abajo no están.
   *
   * Sólo se estira si HOY está dentro de la ventana. Mirando un mes del año
   * pasado, estirar hasta hoy se traería doce meses de citas para no pintar
   * ninguna.
   */
  const finPromesa = new Date()
  finPromesa.setDate(finPromesa.getDate() + 15)
  finPromesa.setHours(23, 59, 59, 999)
  const ahoraMs = Date.now()
  const hoyDentro = ahoraMs >= desde.getTime() && ahoraMs <= hasta.getTime()
  if (hoyDentro && finPromesa.getTime() > hasta.getTime()) hasta.setTime(finPromesa.getTime())

  let q = supabase
    .from("agenda")
    .select(CAMPOS)
    .gte("fecha", desde.toISOString())
    .lte("fecha", hasta.toISOString())
    .order("fecha", { ascending: true })

  if (!sesion.isAdmin) q = q.eq("agente_id", sesion.userId)

  /**
   * Lo vencido, DE LO MÁS VIEJO A LO MÁS RECIENTE.
   *
   * El orden lo decide el tope: con quince vencidas sólo caben las primeras, y
   * de las quince la que nadie recuerda es la de hace cuatro meses, no la de
   * ayer. Ascendente, lo que se corta es lo reciente —lo que además sigue
   * fresco en la cabeza de quien lo apuntó— y lo podrido queda siempre arriba.
   * Es el mismo orden con el que la portada saca los próximos toques.
   *
   * `count: "exact"` junto al `limit` para saber CUÁNTAS hay de verdad sin una
   * segunda consulta, y sin medir un select sin paginar con `.length`, que
   * PostgREST corta a 1.000 con un 200 tan tranquilo.
   *
   * El corte es la MEDIANOCHE DE MADRID, no `ahora`. Dos motivos: una entrada
   * de "todo el día" se guarda a las 00:00 y con `ahora` se declararía vencida
   * a sí misma a las 00:01 del propio día que le toca; y lo de hoy ya tiene su
   * sitio, arriba del todo de "Lo que viene" y en violeta. Así los dos bloques
   * encajan sin solaparse: aquí lo de días pasados, allí de hoy en adelante.
   */
  let qVencidas = supabase
    .from("agenda")
    .select(CAMPOS, { count: "exact" })
    .lt("fecha", inicioDiaMadrid(new Date()).toISOString())
    .eq("completado", false)
    .order("fecha", { ascending: true })
    .limit(TOPE_VENCIDAS)

  if (!sesion.isAdmin) qVencidas = qVencidas.eq("agente_id", sesion.userId)

  const [
    { data: entradas, error },
    { data: filasVencidas, count: totalVencidas, error: errorVencidas },
    { data: perfiles },
  ] = await Promise.all([
    q,
    qVencidas,
    supabase.from("perfiles").select("id, nombre, apellidos, rol")
      .order("rol", { ascending: false }).order("nombre"),
  ])

  const todas = (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: `${p.nombre} ${p.apellidos ?? ""}`.trim(),
    esAdmin: p.rol === "Admin",
  }))

  // El relativo se escribe AQUÍ, en el servidor, y baja ya hecho: ver
  // `EntradaVencida` en lib/agenda.
  const vencidas: EntradaVencida[] = errorVencidas
    ? []
    : ((filasVencidas ?? []) as EntradaAgenda[]).map((e) => ({
        ...e,
        desdeHaceTexto: desdeHace(e.fecha),
      }))

  return {
    entradas: error ? [] : ((entradas ?? []) as EntradaAgenda[]),
    vencidas,
    /** Las que no han cabido en el tope. Se dicen en pantalla, no se callan. */
    vencidasOcultas: Math.max(0, (totalVencidas ?? 0) - vencidas.length),
    personas: sesion.isAdmin ? todas : todas.filter((p) => p.id === sesion.userId),
    disponible: !error,
    yoId: sesion.userId,
    isAdmin: sesion.isAdmin,
  }
}

export async function getAgenda(desdeISO: string, hastaISO: string) {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  let q = supabase
    .from("agenda")
    .select(CAMPOS)
    .gte("fecha", desdeISO)
    .lte("fecha", hastaISO)
    .order("fecha", { ascending: true })

  if (!sesion.isAdmin) q = q.eq("agente_id", sesion.userId)

  const { data, error } = await q
  if (error) return { entradas: [] as EntradaAgenda[], error: error.message }
  return { entradas: (data ?? []) as EntradaAgenda[] }
}

export async function crearEntrada(entrada: {
  titulo: string
  descripcion?: string
  tipo: TipoEntrada
  fecha: string
  todoElDia?: boolean
  agenteId?: string | null
}) {
  const sesion = await sesionActual()

  const titulo = entrada.titulo.trim()
  if (!titulo) return { error: "Hace falta un título" }
  if (!entrada.fecha) return { error: "Hace falta una fecha" }

  // Un agente sólo se apunta cosas a sí mismo, mande lo que mande el navegador.
  const para = sesion.isAdmin ? (entrada.agenteId || sesion.userId) : sesion.userId

  const supabase = await createAdminClient()
  const { error } = await supabase.from("agenda").insert({
    titulo,
    descripcion: entrada.descripcion?.trim() || null,
    tipo: entrada.tipo,
    fecha: entrada.fecha,
    todo_el_dia: entrada.todoElDia ?? false,
    agente_id: para,
    creado_por: sesion.userId,
  })

  if (error) return { error: error.message }
  revalidatePath("/dashboard")
  return { success: true }
}

/** Comprueba que la entrada es de quien dice serlo antes de dejar tocarla. */
async function puedeTocar(id: string) {
  const sesion = await sesionActual()
  if (sesion.isAdmin) return { sesion }

  const supabase = await createAdminClient()
  const { data } = await supabase.from("agenda").select("agente_id").eq("id", id).single()
  if (!data || data.agente_id !== sesion.userId) return { error: "No es tuya" }
  return { sesion }
}

export async function marcarCompletado(id: string, completado: boolean) {
  const permiso = await puedeTocar(id)
  if (permiso.error) return { error: permiso.error }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("agenda")
    .update({ completado, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/dashboard")
  return { success: true }
}

export async function eliminarEntrada(id: string) {
  const permiso = await puedeTocar(id)
  if (permiso.error) return { error: permiso.error }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("agenda").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/dashboard")
  return { success: true }
}
