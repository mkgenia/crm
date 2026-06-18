"use server"

import { createAdminClient } from "@/lib/supabase/server"
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
