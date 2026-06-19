"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { EstadoLead } from "@/types/captaciones"

export async function getLeadByPhone(phone: string) {
  const supabase = await createAdminClient()
  const local = phone.replace(/\D/g, "").slice(-9)
  const { data } = await supabase
    .from("leads")
    .select("id, nombre, apellidos, telefono, email, estado, notas, fuente, fecha_creacion, captacion_id")
    .ilike("telefono", `%${local}`)
    .maybeSingle()
  return data ?? null
}

export async function actualizarEstadoLead(leadId: string, estado: EstadoLead) {
  const supabase = await createClient()
  const { error } = await supabase.from("leads").update({ estado }).eq("id", leadId)
  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true }
}

export async function actualizarNotasLead(leadId: string, notas: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("leads").update({ notas: notas || null }).eq("id", leadId)
  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true }
}

export async function crearLeadDesdeChat(nombre: string, telefono: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .ilike("telefono", `%${telefono.slice(-9)}`)
    .maybeSingle()
  if (existing) return { error: "Ya existe un lead con ese teléfono", leadId: existing.id }

  const { data: lead, error } = await supabase.from("leads").insert({
    nombre: nombre || "Contacto",
    telefono,
    fuente: "Mensajes",
    estado: "Nuevo",
    captado_por: user.id,
    fecha_creacion: new Date().toISOString(),
  }).select("id").single()

  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true, leadId: lead.id }
}

export async function crearLeadDesdeCaptacion(captacionId: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const { data: cap, error: capErr } = await supabase
    .from("captaciones")
    .select("nombre, telefono, calle, barrio, precio")
    .eq("id", captacionId)
    .single()

  if (capErr || !cap) return { error: "No se encontró la captación" }

  // Comprobar si ya existe un lead con ese teléfono
  if (cap.telefono) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("telefono", cap.telefono)
      .maybeSingle()
    if (existing) return { error: "Ya existe un lead con ese teléfono", leadId: existing.id }
  }

  const notas = [
    cap.calle ? `Propiedad: ${cap.calle}` : null,
    cap.barrio ? `Zona: ${cap.barrio}` : null,
    cap.precio ? `Precio: ${cap.precio.toLocaleString("es-ES")} €` : null,
  ].filter(Boolean).join("\n")

  const { data: lead, error } = await supabase.from("leads").insert({
    nombre:       cap.nombre || "Propietario",
    telefono:     cap.telefono || null,
    fuente:       "Captación",
    notas:        notas || null,
    estado:       "Nuevo",
    captado_por:  user.id,
    fecha_creacion: new Date().toISOString(),
  }).select("id").single()

  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true, leadId: lead.id }
}

export async function actualizarLead(leadId: string, data: {
  telefono?: string | null
  email?: string | null
  notas?: string | null
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }
  const { error } = await supabase.from("leads").update(data).eq("id", leadId)
  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true }
}

export async function crearLead(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const nombre = (formData.get("nombre") as string)?.trim()
  if (!nombre) return { error: "El nombre es obligatorio" }

  const { error } = await supabase.from("leads").insert({
    nombre,
    apellidos:  (formData.get("apellidos") as string)?.trim() || null,
    telefono:   (formData.get("telefono") as string)?.trim() || null,
    fuente:     (formData.get("fuente") as string)?.trim() || "Manual",
    notas:      (formData.get("notas") as string)?.trim() || null,
    estado:     "Nuevo",
    captado_por: user.id,
    fecha_creacion: new Date().toISOString(),
  })

  if (error) return { error: error.message }
  revalidatePath("/leads")
  return { success: true }
}
