"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import { REGLAS_POR_DEFECTO, type AgenteReparto, type ReglasAsignacion } from "@/lib/asignacion"

/**
 * El reparto de captaciones entre los agentes.
 *
 * Se reparten CAPTACIONES y no leads: lo que hay que repartir es a quién le toca
 * llamar a cada propietario que saca el scraper. Un lead de la landing o del
 * formulario web no se reparte hoy.
 *
 * A quién le toca no se decide aquí, se decide en la base de datos
 * (`siguiente_agente()` y el trigger de la migración 017). Tiene que ser así
 * porque las captaciones las crea el workflow de ingesta escribiendo directo
 * contra PostgREST, sin pasar por este código: si la rotación viviera en
 * TypeScript, todo lo que entra por el scraper se quedaría sin repartir.
 *
 * Lo que sí vive aquí es lo que la base de datos no puede saber: quién está
 * pidiendo la acción y si tiene permiso.
 */

const CLAVES = ["asignacion_modo", "asignacion_cursor", "asignacion_reglas"] as const

export type ModoAsignacion = "manual" | "automatico"

export interface EstadoAsignacion {
  modo: ModoAsignacion
  cursor: number
  reglas: ReglasAsignacion
  agentes: Array<AgenteReparto & { captacionesAbiertas: number }>
  /** Cuántas captaciones activas esperan agente. */
  sinAsignar: number
}

async function leerAjustes(supabase: Awaited<ReturnType<typeof createAdminClient>>) {
  const { data } = await supabase.from("app_settings").select("key, value").in("key", CLAVES as unknown as string[])
  const m = new Map((data ?? []).map((r) => [r.key, r.value]))
  return {
    modo: (m.get("asignacion_modo") ?? "manual") as ModoAsignacion,
    cursor: Number(m.get("asignacion_cursor") ?? 0) || 0,
    reglas: { ...REGLAS_POR_DEFECTO, ...((m.get("asignacion_reglas") ?? {}) as Partial<ReglasAsignacion>) },
  }
}

async function guardarAjuste(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  key: string,
  value: unknown
) {
  await supabase.from("app_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  )
}

/** Todo lo que necesita el panel de reparto, de una vez. */
export async function getEstadoAsignacion(): Promise<EstadoAsignacion> {
  await sesionActual()
  const supabase = await createAdminClient()

  const ajustes = await leerAjustes(supabase)

  const [{ data: perfiles }, { data: abiertas }, { count: sinAsignar }] = await Promise.all([
    supabase.from("perfiles")
      .select("id, nombre, apellidos, rol, disponible, orden_reparto, zonas, especialidades")
      .neq("rol", "Admin"),
    // "Abiertas" = las que siguen vivas y todavía dan trabajo. Las cerradas no
    // cuentan como carga: el total histórico sólo crece y no dice nada de quién
    // está saturado hoy.
    supabase.from("captaciones").select("agente_id")
      .not("agente_id", "is", null)
      .eq("activo", true)
      .not("estado_whatsapp", "in", '("No_Interesado","Sin_Telefono","Sin_WhatsApp","Duplicado","Traspaso")'),
    supabase.from("captaciones").select("id", { count: "exact", head: true })
      .is("agente_id", null).eq("activo", true),
  ])

  const carga = new Map<string, number>()
  for (const c of abiertas ?? []) {
    if (c.agente_id) carga.set(c.agente_id, (carga.get(c.agente_id) ?? 0) + 1)
  }

  const agentes = (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: `${p.nombre} ${p.apellidos ?? ""}`.trim(),
    disponible: p.disponible ?? true,
    orden_reparto: p.orden_reparto,
    zonas: p.zonas ?? [],
    especialidades: p.especialidades ?? [],
    captacionesAbiertas: carga.get(p.id) ?? 0,
  })).sort((a, b) => (a.orden_reparto ?? 999) - (b.orden_reparto ?? 999))

  return { ...ajustes, agentes, sinAsignar: sinAsignar ?? 0 }
}

/** Asignación a mano. */
export async function asignarAMano(ids: number[], agenteId: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }
  if (ids.length === 0) return { error: "No has seleccionado ninguna captación" }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("captaciones").update({
    agente_id: agenteId,
    asignado_en: new Date().toISOString(),
    asignado_por: sesion.userId,
    asignacion_motivo: `A mano por ${sesion.nombre}`,
    // Se marca como no vista para que le salte el aviso al agente.
    visto_en: null,
  }).in("id", ids)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { ok: true }
}

/** Repartir una tanda por turno, sin necesidad de encender el modo automático. */
export async function repartirPorTurno(ids: number[]): Promise<{ ok?: true; repartidas?: number; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }
  if (ids.length === 0) return { error: "No has seleccionado ninguna captación" }

  const supabase = await createAdminClient()

  // Una a una a propósito: cada llamada avanza el cursor, así que la tanda rota
  // de verdad en vez de caerle entera al mismo agente.
  let repartidas = 0
  let ultimoMotivo = ""
  for (const id of ids) {
    const { data, error } = await supabase.rpc("asignar_captacion", { p_captacion_id: id })
    if (error) return { error: error.message }
    const fila = (Array.isArray(data) ? data[0] : data) as { agente_id: string | null; motivo: string } | undefined
    if (fila?.agente_id) repartidas++
    else ultimoMotivo = fila?.motivo ?? ""
  }

  if (repartidas === 0) {
    return { error: ultimoMotivo || "No hay ningún agente disponible en la rotación" }
  }

  revalidatePath("/captaciones")
  return { ok: true, repartidas }
}

/**
 * Repartir el atasco de captaciones sin agente.
 *
 * Los ids se buscan en el servidor y no se mandan desde el navegador: son
 * cientos, y una lista así viajando en cada clic es tan frágil como innecesaria.
 * El tope existe para que una sola pulsación no reparta novecientas de golpe sin
 * que nadie pueda mirar el resultado antes de seguir.
 */
export async function repartirPendientes(tope = 50): Promise<{ ok?: true; repartidas?: number; quedan?: number; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select("id")
    .is("agente_id", null)
    .eq("activo", true)
    .not("telefono", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, tope), 200))

  if (error) return { error: error.message }
  if (!data?.length) return { error: "No queda ninguna captación sin asignar" }

  const r = await repartirPorTurno(data.map((c) => c.id as number))
  if (r.error) return { error: r.error }

  const { count } = await supabase.from("captaciones")
    .select("id", { count: "exact", head: true })
    .is("agente_id", null).eq("activo", true)

  return { ok: true, repartidas: r.repartidas, quedan: count ?? 0 }
}

/**
 * Un agente rechaza una captación: vuelve al pool y no se le vuelve a ofrecer.
 *
 * Se apunta quién la rechazó, no sólo que fue rechazada: si no, la siguiente
 * vuelta de la rotación se la devolvería al mismo.
 */
export async function rechazarCaptacion(id: number, motivo?: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: cap } = await supabase
    .from("captaciones").select("agente_id, rechazado_por").eq("id", id).maybeSingle()
  if (!cap) return { error: "Esa captación ya no existe" }
  if (!sesion.isAdmin && cap.agente_id !== sesion.userId) {
    return { error: "Esa captación no es tuya" }
  }

  const yaRechazaron = new Set<string>(cap.rechazado_por ?? [])
  if (cap.agente_id) yaRechazaron.add(cap.agente_id)

  const { error } = await supabase.from("captaciones").update({
    agente_id: null,
    asignado_en: null,
    asignado_por: null,
    asignacion_motivo: `Rechazada por ${sesion.nombre}${motivo?.trim() ? `: ${motivo.trim()}` : ""}`,
    rechazado_por: [...yaRechazaron],
  }).eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { ok: true }
}

/** El interruptor manual/automático. */
export async function cambiarModo(modo: ModoAsignacion): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador cambia el modo de reparto" }

  const supabase = await createAdminClient()
  await guardarAjuste(supabase, "asignacion_modo", modo)
  revalidatePath("/captaciones")
  return { ok: true }
}

export async function cambiarReglas(reglas: Partial<ReglasAsignacion>): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador cambia las reglas" }

  const supabase = await createAdminClient()
  const ajustes = await leerAjustes(supabase)
  await guardarAjuste(supabase, "asignacion_reglas", { ...ajustes.reglas, ...reglas })
  revalidatePath("/captaciones")
  return { ok: true }
}

/**
 * Marcarse disponible o no.
 *
 * Un agente sólo puede cambiarse a sí mismo; el administrador, a cualquiera —
 * hace falta para el que se pone malo y no entra al CRM a marcarlo.
 */
export async function cambiarDisponibilidad(
  agenteId: string,
  disponible: boolean
): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin && agenteId !== sesion.userId) {
    return { error: "Sólo puedes cambiar tu propia disponibilidad" }
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("perfiles").update({ disponible }).eq("id", agenteId)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * Reordenar la rotación.
 *
 * Llega la lista entera de ids en el orden nuevo. Se escribe en dos pasadas
 * porque `orden_reparto` tiene índice único: asignar el 2 a quien va a ser el 1
 * mientras el 2 sigue ocupado reventaría. Primero se aparcan en negativo, que
 * ningún puesto real usa, y luego se bajan a su sitio.
 */
export async function reordenarRotacion(idsEnOrden: string[]): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador ordena la rotación" }

  const supabase = await createAdminClient()

  for (let i = 0; i < idsEnOrden.length; i++) {
    const { error } = await supabase.from("perfiles").update({ orden_reparto: -(i + 1) }).eq("id", idsEnOrden[i])
    if (error) return { error: error.message }
  }
  for (let i = 0; i < idsEnOrden.length; i++) {
    const { error } = await supabase.from("perfiles").update({ orden_reparto: i + 1 }).eq("id", idsEnOrden[i])
    if (error) return { error: error.message }
  }

  revalidatePath("/captaciones")
  return { ok: true }
}

/** Sacar a alguien de la rotación sin marcarlo como no disponible. */
export async function fueraDeRotacion(agenteId: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador ordena la rotación" }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("perfiles").update({ orden_reparto: null }).eq("id", agenteId)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  return { ok: true }
}
