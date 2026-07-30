"use server"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export type Operacion = "venta" | "alquiler"

export interface FactoresMercado {
  // Multiplicador a aplicar al €/m² si el piso NO tiene ascensor (< 1). Calculado de los datos.
  ascensorFactor: number
  muestraAscensor: number
}

function mediana(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Coeficientes calculados a partir del mercado real (data-backed).
export async function getFactoresMercado(operacion: Operacion = "venta"): Promise<FactoresMercado> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("mercado_inmuebles")
    .select("ascensor, precio_m2")
    .eq("operacion", operacion)
    .eq("activo", true)
    .not("precio_m2", "is", null)

  const rows = (data ?? []) as { ascensor: boolean | null; precio_m2: number }[]
  const con = rows.filter((r) => r.ascensor === true).map((r) => r.precio_m2)
  const sin = rows.filter((r) => r.ascensor === false).map((r) => r.precio_m2)
  const mCon = mediana(con)
  const mSin = mediana(sin)

  // Ratio sin/con, acotado a un rango sensato para evitar distorsiones por muestras pequeñas
  let factor = 0.9
  if (mCon && mSin && mCon > 0) {
    factor = Math.min(1, Math.max(0.8, mSin / mCon))
  }
  return { ascensorFactor: Math.round(factor * 100) / 100, muestraAscensor: con.length + sin.length }
}

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

export interface GeoResultado {
  lat: number
  lng: number
  direccion: string
  refCatastral: string | null
}

// Geocodificación de una dirección con CartoCiudad (IGN, gratis, sin key).
export async function geocodificar(direccion: string): Promise<GeoResultado | null> {
  const q = encodeURIComponent(`${direccion.trim()}, Valencia`)
  try {
    const res = await fetch(`https://www.cartociudad.es/geocoder/api/geocoder/find?q=${q}`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return null
    const d = await res.json()
    if (d == null || d.lat == null || d.lng == null) return null
    const dir = [d.tip_via, d.address, d.portalNumber].filter(Boolean).join(" ")
    return {
      lat: Number(d.lat),
      lng: Number(d.lng),
      direccion: dir || direccion.trim(),
      refCatastral: d.refCatastral ?? null,
    }
  } catch {
    return null
  }
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
