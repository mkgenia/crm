"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"

export async function actualizarDemanda(id: string, data: {
  estado?: string
  notas?: string | null
  visto?: boolean
}) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("demandas").update(data).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/demandas")
  return { success: true }
}

export async function eliminarDemanda(id: string) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("demandas").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/demandas")
  return { success: true }
}

export async function actualizarPropiedad(id: string, data: {
  tipo?: string
  accion?: string
  ciudad?: string
  zona?: string
  cp?: string
  precio_alquiler?: number
  precio_venta?: number
  habitaciones?: number
  banyos?: number
  m_construidos?: number
  titulo?: string
  descripcion?: string
}) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("propiedades_demanda")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/demandas")
  return { success: true }
}

export async function desactivarPropiedad(id: string) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("propiedades_demanda")
    .update({ activo: false })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/demandas")
  return { success: true }
}

export async function eliminarPropiedad(id: string) {
  const supabase = await createAdminClient()
  // Elimina primero las demandas asociadas (FK constraint)
  const { error: errDemandas } = await supabase.from("demandas").delete().eq("propiedad_id", id)
  if (errDemandas) return { error: errDemandas.message }
  const { error } = await supabase.from("propiedades_demanda").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/demandas")
  return { success: true }
}

/**
 * Los agentes a los que se le puede encargar una visita.
 *
 * Misma consulta que usa la agenda: admins primero y luego por nombre, para que
 * la lista salga siempre en el mismo orden esté donde esté.
 */
export async function getAgentesParaVisita() {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("perfiles").select("id, nombre, apellidos, rol")
    .order("rol", { ascending: false }).order("nombre")
  return (data ?? []).map((p) => ({
    id: p.id,
    nombre: `${p.nombre} ${p.apellidos ?? ""}`.trim(),
  }))
}

/**
 * Confirma la visita que aceptó el cliente y la pone en la agenda del agente.
 *
 * El bot deja la visita en `aceptada` y ahí se para a propósito: ocupar el
 * calendario de alguien que no lo ha visto es la forma más rápida de que nadie
 * se fíe del calendario. Este es el paso que faltaba, y lo da una persona.
 *
 * Las dos escrituras van juntas porque valen lo mismo: una visita apuntada en
 * la demanda pero no en la agenda no la ve el agente, y una entrada en la
 * agenda sin marcar la demanda la deja pidiendo confirmación para siempre. Si
 * falla la segunda se deshace la primera.
 */
export async function confirmarVisita(demandaId: string, agenteId: string) {
  if (!agenteId) return { error: "Hace falta elegir un agente" }

  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: d, error: eLeer } = await supabase
    .from("demandas")
    .select("id, nombre, telefono, visita_propuesta_en, visita_estado, propiedades_demanda(ref, tipo, zona, ciudad)")
    .eq("id", demandaId)
    .single()

  if (eLeer || !d) return { error: eLeer?.message ?? "No encuentro la demanda" }
  if (!d.visita_propuesta_en) return { error: "Esa demanda no tiene visita propuesta" }
  if (d.visita_estado === "confirmada") return { error: "Ya estaba confirmada" }

  const p = (Array.isArray(d.propiedades_demanda) ? d.propiedades_demanda[0] : d.propiedades_demanda) as
    | { ref?: string; tipo?: string; zona?: string; ciudad?: string } | null

  // El título es lo único que se lee en la rejilla del mes, así que lleva a
  // quién se visita y qué se enseña; el resto va en la descripción.
  const sitio = p?.zona || p?.ciudad || ""
  const titulo = `Visita · ${d.nombre || "Cliente"}${sitio ? ` · ${sitio}` : ""}`
  const descripcion = [
    p?.tipo && p?.ref ? `${p.tipo} ref. ${p.ref}` : p?.ref ? `Ref. ${p.ref}` : null,
    d.telefono,
    "Visita aceptada por el cliente con el bot de demandas",
  ].filter(Boolean).join("\n")

  const { data: entrada, error: eAgenda } = await supabase.from("agenda").insert({
    titulo,
    descripcion,
    tipo: "visita",
    fecha: d.visita_propuesta_en,
    todo_el_dia: false,
    agente_id: agenteId,
    creado_por: sesion.userId,
    demanda_id: demandaId,
  }).select("id").single()

  if (eAgenda) return { error: eAgenda.message }

  const { error: eDemanda } = await supabase
    .from("demandas")
    .update({ visita_estado: "confirmada" })
    .eq("id", demandaId)

  if (eDemanda) {
    // Sin esto quedaría una visita en la agenda de alguien y la demanda
    // pidiendo confirmación: dos verdades distintas sobre la misma cita.
    await supabase.from("agenda").delete().eq("id", entrada.id)
    return { error: eDemanda.message }
  }

  revalidatePath("/demandas")
  revalidatePath("/dashboard")
  return { success: true }
}
