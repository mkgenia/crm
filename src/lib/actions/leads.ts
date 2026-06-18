"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

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
