"use server"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Permisos } from "@/types/database"

export async function completarOnboarding() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from("perfiles").update({ onboarding_done: true }).eq("id", user.id)
}

export async function getUsuarios() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("perfiles")
    .select("id, nombre, apellidos, rol, avatar_url, telefono, permisos, created_at, usuario")
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

export async function updatePerfil(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const nombre = (formData.get("nombre") as string)?.trim()
  if (!nombre) return { error: "El nombre es obligatorio" }

  const { error } = await supabase
    .from("perfiles")
    .update({
      nombre,
      apellidos: (formData.get("apellidos") as string)?.trim() || null,
      telefono:  (formData.get("telefono") as string)?.trim() || null,
    })
    .eq("id", user.id)

  if (error) return { error: error.message }

  const nuevaPassword = (formData.get("password") as string)?.trim()
  if (nuevaPassword) {
    const { error: pwError } = await supabase.auth.updateUser({ password: nuevaPassword })
    if (pwError) return { error: pwError.message }
  }

  revalidatePath("/configuracion")
  return { success: true }
}

async function verificarAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: perfil } = await supabase.from("perfiles").select("rol").eq("id", user.id).single()
  return perfil?.rol === "Admin" ? user : null
}

export async function actualizarPermisos(userId: string, permisos: Permisos) {
  if (!await verificarAdmin()) return { error: "No autorizado" }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("perfiles")
    .update({ permisos })
    .eq("id", userId)

  if (error) return { error: error.message }
  revalidatePath("/equipo")
  return { success: true }
}

export async function actualizarRol(userId: string, rol: string) {
  if (!await verificarAdmin()) return { error: "No autorizado" }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("perfiles")
    .update({ rol })
    .eq("id", userId)

  if (error) return { error: error.message }
  revalidatePath("/equipo")
  return { success: true }
}

export async function eliminarUsuario(userId: string) {
  if (!await verificarAdmin()) return { error: "No autorizado" }
  const supabase = await createAdminClient()
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }
  revalidatePath("/equipo")
  return { success: true }
}

export async function invitarUsuario(formData: FormData) {
  if (!await verificarAdmin()) return { error: "No autorizado" }

  const email = formData.get("email") as string
  const nombre = formData.get("nombre") as string
  const apellidos = formData.get("apellidos") as string
  const rol = formData.get("rol") as string

  const supabase = await createAdminClient()

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { nombre, apellidos, rol },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  })

  if (error) return { error: error.message }

  await supabase.from("perfiles").upsert({
    id: data.user.id,
    nombre,
    apellidos,
    rol,
    permisos: { leads: true, mensajes: true, captaciones: true },
  })

  revalidatePath("/equipo")
  return { success: true }
}
