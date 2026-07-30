"use server"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export type Operacion = "venta" | "alquiler"

export interface ZonaStat {
  codbarrio: string
  operacion: string
  muestra: number
  precio_m2_mediana: number | null
  precio_m2_p25: number | null
  precio_m2_p75: number | null
  precio_m2_medio: number | null
  actualizado: string | null
}

export interface ComparableInmueble {
  id: number
  idealista_id: string
  operacion: string
  tipo: string | null
  codbarrio: string | null
  barrio: string | null
  lat: number | null
  lng: number | null
  precio: number
  metros: number
  precio_m2: number
  habitaciones: number | null
  banos: number | null
  planta: string | null
  ascensor: boolean | null
  anunciante: string | null
  agencia_nombre: string | null
  fecha_ultima_vista: string | null
}

export interface Valoracion {
  id: number
  creada_en: string
  creada_por: string | null
  direccion: string | null
  codbarrio: string | null
  barrio: string | null
  lat: number | null
  lng: number | null
  metros: number | null
  habitaciones: number | null
  operacion: string
  precio_m2_zona: number | null
  valor_estimado: number | null
  valor_min: number | null
  valor_max: number | null
  muestra: number | null
  notas: string | null
  autor?: { nombre: string; apellidos: string | null } | null
}

// Stats €/m² por barrio para una operación. Devuelve mapa codbarrio -> stat.
export async function getZonasStats(operacion: Operacion = "venta"): Promise<ZonaStat[]> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("mercado_zonas_stats")
    .select("*")
    .eq("operacion", operacion)
  if (error) return []
  return (data ?? []) as ZonaStat[]
}

// Comparables individuales de un barrio para ver y filtrar en el Valorador
export async function getComparablesBarrio(
  codbarrio: string,
  operacion: Operacion = "venta"
): Promise<ComparableInmueble[]> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("mercado_inmuebles")
    .select("id, idealista_id, operacion, tipo, codbarrio, barrio, lat, lng, precio, metros, precio_m2, habitaciones, banos, planta, ascensor, anunciante, agencia_nombre, fecha_ultima_vista")
    .eq("codbarrio", codbarrio)
    .eq("operacion", operacion)
    .eq("activo", true)
    .not("precio_m2", "is", null)
    .order("precio_m2", { ascending: true })
  if (error) return []
  return (data ?? []) as ComparableInmueble[]
}

export async function getValoraciones(): Promise<Valoracion[]> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("valoraciones")
    .select("*, autor:perfiles!valoraciones_creada_por_fkey(nombre, apellidos)")
    .order("creada_en", { ascending: false })
    .limit(200)
  if (error) return []
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    autor: Array.isArray(row.autor) ? (row.autor[0] ?? null) : (row.autor ?? null),
  })) as Valoracion[]
}

export interface CrearValoracionInput {
  direccion?: string | null
  codbarrio: string | null
  barrio: string | null
  lat?: number | null
  lng?: number | null
  metros: number
  habitaciones?: number | null
  operacion: Operacion
  precio_m2_zona: number
  valor_estimado: number
  valor_min: number
  valor_max: number
  muestra: number
  notas?: string | null
}

export async function crearValoracion(input: CrearValoracionInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = await createAdminClient()
  const { data, error } = await admin
    .from("valoraciones")
    .insert({ ...input, creada_por: user?.id ?? null })
    .select("*, autor:perfiles!valoraciones_creada_por_fkey(nombre, apellidos)")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/valorador")
  const row = data as Record<string, unknown>
  const valoracion = {
    ...row,
    autor: Array.isArray(row.autor) ? (row.autor[0] ?? null) : (row.autor ?? null),
  } as Valoracion
  return { valoracion }
}

export async function eliminarValoracion(id: number) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("valoraciones").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/valorador")
  return { success: true }
}
