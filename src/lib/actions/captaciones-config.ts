"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function getAutoContactoConfig() {
  const supabase = await createAdminClient()

  const [{ data: settings }, { data: zonas }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["auto_contact_enabled"]),
    supabase
      .from("scraper_zonas")
      .select("id, url, nombre, activa, tipo, search_name, coords")
      .order("id"),
  ])

  // value es jsonb — puede ser booleano true o el string "true" según cómo se guardó
  const raw = settings?.find((s) => s.key === "auto_contact_enabled")?.value
  const enabled = raw === true || raw === "true"

  return { enabled, zonas: zonas ?? [] }
}

export async function toggleAutoContacto(enabled: boolean) {
  const supabase = await createAdminClient()
  // Guardar como booleano jsonb real (compatible con n8n que compara value === true)
  await supabase
    .from("app_settings")
    .upsert({ key: "auto_contact_enabled", value: enabled }, { onConflict: "key" })
  revalidatePath("/captaciones")
  return { success: true }
}

export async function agregarZona(
  url: string,
  nombre: string,
  tipo: "nombre" | "zona" = "zona",
  search_name?: string | null,
  coords?: [number, number][] | null,
) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("scraper_zonas").insert({
    url: url.trim(),
    nombre: nombre.trim(),
    activa: false,
    tipo,
    search_name: search_name ?? null,
    coords: coords ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function toggleZona(id: string, activa: boolean) {
  const supabase = await createAdminClient()
  if (activa) {
    await supabase.from("scraper_zonas").update({ activa: false }).neq("id", id)
  }
  await supabase.from("scraper_zonas").update({ activa }).eq("id", id)
  revalidatePath("/captaciones")
  return { success: true }
}

export async function eliminarZona(id: string) {
  const supabase = await createAdminClient()
  await supabase.from("scraper_zonas").delete().eq("id", id)
  revalidatePath("/captaciones")
  return { success: true }
}
