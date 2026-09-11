"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import type { EntradaAgenda, TipoEntrada } from "@/lib/agenda"

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
 * Las seis semanas que pinta la rejilla del mes, más la lista de personas.
 *
 * Se piden seis semanas completas y no del 1 al 31: los días de los meses
 * vecinos que se ven en las esquinas del calendario saldrían siempre vacíos.
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

  let q = supabase
    .from("agenda")
    .select("id, titulo, descripcion, tipo, fecha, todo_el_dia, agente_id, creado_por, completado, created_at")
    .gte("fecha", desde.toISOString())
    .lte("fecha", hasta.toISOString())
    .order("fecha", { ascending: true })

  if (!sesion.isAdmin) q = q.eq("agente_id", sesion.userId)

  const [{ data: entradas, error }, { data: perfiles }] = await Promise.all([
    q,
    supabase.from("perfiles").select("id, nombre, apellidos, rol")
      .order("rol", { ascending: false }).order("nombre"),
  ])

  const todas = (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: `${p.nombre} ${p.apellidos ?? ""}`.trim(),
    esAdmin: p.rol === "Admin",
  }))

  return {
    entradas: error ? [] : ((entradas ?? []) as EntradaAgenda[]),
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
    .select("id, titulo, descripcion, tipo, fecha, todo_el_dia, agente_id, creado_por, completado, created_at")
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
