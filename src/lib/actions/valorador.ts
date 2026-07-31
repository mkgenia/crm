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

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // metros
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Comparables dentro de un radio (metros) alrededor de un punto. Estilo "BetterPlace".
export async function getComparablesRadio(
  lat: number,
  lng: number,
  radioMetros: number,
  operacion: Operacion = "venta"
): Promise<ComparableInmueble[]> {
  const supabase = await createAdminClient()
  // Bounding box para reducir la consulta; luego se afina con haversine.
  const dLat = radioMetros / 111320
  const dLng = radioMetros / (111320 * Math.cos((lat * Math.PI) / 180) || 1)
  const { data, error } = await supabase
    .from("mercado_inmuebles")
    .select("id, idealista_id, operacion, tipo, codbarrio, barrio, lat, lng, precio, metros, precio_m2, habitaciones, banos, planta, ascensor, anunciante, agencia_nombre, fecha_ultima_vista")
    .eq("operacion", operacion)
    .eq("activo", true)
    .not("precio_m2", "is", null)
    .not("lat", "is", null)
    .gte("lat", lat - dLat).lte("lat", lat + dLat)
    .gte("lng", lng - dLng).lte("lng", lng + dLng)
  if (error) return []
  const rows = (data ?? []) as ComparableInmueble[]
  return rows
    .filter((r) => r.lat != null && r.lng != null && haversine(lat, lng, r.lat, r.lng) <= radioMetros)
    .sort((a, b) => a.precio_m2 - b.precio_m2)
}

export interface GeoResultado {
  lat: number
  lng: number
  direccion: string
  refCatastral: string | null
  tip_via?: string
  address?: string
  portalNumber?: number | null
  muni?: string
  province?: string
}

// Geocodificación de una dirección con CartoCiudad (IGN, gratis, sin key).
export async function geocodificar(direccion: string): Promise<GeoResultado | null> {
  const dirTrim = direccion.trim()
  if (!dirTrim) return null
  const qDir = /valencia|torrent|gandia|paterna|mislata|sagunto|alzira/i.test(dirTrim) ? dirTrim : `${dirTrim}, Valencia`
  const q = encodeURIComponent(qDir)
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
      direccion: dir || dirTrim,
      refCatastral: d.refCatastral ?? null,
      tip_via: d.tip_via,
      address: d.address,
      portalNumber: d.portalNumber != null ? Number(d.portalNumber) : null,
      muni: d.muni,
      province: d.province,
    }
  } catch {
    return null
  }
}

export interface UnidadCatastro {
  rc: string          // referencia catastral (20 car.)
  planta: string      // pt
  puerta: string      // pu
  escalera: string    // es
  uso: string         // Residencial, Comercial, ...
  superficie: number | null // m² construidos
  anio: string | null // año construcción
  plantaNum?: number | null // número de planta parseado (0=bajo, 1=1ª...)
}

export interface CatastroResultado {
  lat: number
  lng: number
  direccion: string
  unidades: UnidadCatastro[]
  totalPlantas?: number | null // número máximo de plantas del edificio
}

const _norm = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()

const TIPVIA_SIGLA: Record<string, string> = {
  CALLE: "CL", CARRER: "CL", CL: "CL",
  AVENIDA: "AV", AVINGUDA: "AV", AV: "AV",
  PLAZA: "PZ", PLACA: "PZ", PZ: "PZ",
  PASEO: "PS", PASSEIG: "PS", PS: "PS",
  CAMINO: "CM", CAMI: "CM", CM: "CM",
  RONDA: "RD", RD: "RD",
  CARRETERA: "CR", CR: "CR",
  TRAVESIA: "TR", TR: "TR",
  "GRAN VIA": "GV", GRANVIA: "GV", GV: "GV",
  VIA: "VI", VI: "VI", MERCADO: "CL",
}

function parsePlantaNumber(pt: string): number | null {
  if (!pt) return null
  const p = pt.trim().toUpperCase()
  if (["B0", "BJ", "PB", "EN", "BA", "00", "BJ0", "BJ1"].includes(p)) return 0
  const num = parseInt(p.replace(/\D/g, ""))
  return isNaN(num) ? null : num
}

// Extrae fincas del JSON del Catastro (tanto lrcdnp con división horizontal como bico único)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCatastroUnits(result: any): UnidadCatastro[] {
  if (!result) return []

  const extract = (u: any): UnidadCatastro => {
    const rc = u.rc ?? u.idbi?.rc ?? {}
    const loint = u.dt?.locs?.lous?.lourb?.loint ?? {}
    const debi = u.debi ?? {}
    const pt = loint.pt ?? ""
    return {
      rc: `${rc.pc1 ?? ""}${rc.pc2 ?? ""}${rc.car ?? ""}${rc.cc1 ?? ""}${rc.cc2 ?? ""}`,
      planta: pt,
      puerta: loint.pu ?? "",
      escalera: loint.es ?? "",
      uso: debi.luso ?? "—",
      superficie: debi.sfc != null ? Number(debi.sfc) : null,
      anio: debi.ant ?? null,
      plantaNum: parsePlantaNumber(pt),
    }
  }

  // Formato 1: lrcdnp (edificio con división horizontal / múltiples fincas)
  if (result.lrcdnp?.rcdnp) {
    let list = result.lrcdnp.rcdnp
    if (!Array.isArray(list)) list = [list]
    return list.map(extract)
  }

  // Formato 2: bico (inmueble único sin división horizontal)
  if (result.bico?.bi) {
    let list = result.bico.bi
    if (!Array.isArray(list)) list = [list]
    return list.map(extract)
  }

  return []
}

// Consulta DNPLOC a la API del Catastro
async function consultarCatastroDNPLOC(
  provincia: string,
  municipio: string,
  sigla: string,
  calle: string,
  numero: number
): Promise<UnidadCatastro[] | { fallbackNum: number } | null> {
  try {
    const url = `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPLOC`
      + `?Provincia=${encodeURIComponent(provincia)}&Municipio=${encodeURIComponent(municipio)}`
      + `&Sigla=${encodeURIComponent(sigla)}&Calle=${encodeURIComponent(calle)}`
      + `&Numero=${encodeURIComponent(String(numero))}`
    const dres = await fetch(url, { headers: { Accept: "application/json" } })
    if (!dres.ok) return null
    const text = await dres.text()
    const dj = JSON.parse(text.replace(/^\uFEFF/, ""))
    const result = dj?.consulta_dnplocResult
    if (!result) return null

    const units = parseCatastroUnits(result)
    if (units.length > 0) return units

    // Si el número exacto no tiene fincas pero Catastro devuelve números de portal cercanos
    if (result.control?.cunum > 0 && result.numerero?.nump) {
      let numps = result.numerero.nump
      if (!Array.isArray(numps)) numps = [numps]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidateNums = numps.map((x: any) => parseInt(x.num?.pnp)).filter((n: number) => !isNaN(n))
      if (candidateNums.length > 0) {
        candidateNums.sort((a: number, b: number) => Math.abs(a - numero) - Math.abs(b - numero))
        return { fallbackNum: candidateNums[0] }
      }
    }

    return null
  } catch {
    return null
  }
}

// Consulta DNPRC a la API del Catastro por Referencia Catastral (14 caracteres)
async function consultarCatastroDNPRC(
  provincia: string,
  municipio: string,
  refCat: string
): Promise<UnidadCatastro[] | null> {
  try {
    const url = `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC`
      + `?Provincia=${encodeURIComponent(provincia)}&Municipio=${encodeURIComponent(municipio)}`
      + `&RefCat=${encodeURIComponent(refCat.substring(0, 14))}`
    const dres = await fetch(url, { headers: { Accept: "application/json" } })
    if (!dres.ok) return null
    const text = await dres.text()
    const dj = JSON.parse(text.replace(/^\uFEFF/, ""))
    const result = dj?.consulta_dnprcResult
    if (!result) return null

    const units = parseCatastroUnits(result)
    if (units.length > 0) return units
    return null
  } catch {
    return null
  }
}

// Dirección → geocode (CartoCiudad) + fincas del Catastro (DNPLOC): pisos, puertas, uso, m².
export async function buscarCatastro(direccion: string): Promise<CatastroResultado | null> {
  const geo = await geocodificar(direccion)
  if (!geo) return null
  const base: CatastroResultado = { lat: geo.lat, lng: geo.lng, direccion: geo.direccion, unidades: [] }

  let provincia = _norm((geo.province ?? "VALENCIA").split("/")[0])
  if (provincia.includes("VALENC")) provincia = "VALENCIA"
  let municipio = _norm(geo.muni ?? "VALENCIA")
  if (municipio.includes("VALENC")) municipio = "VALENCIA"

  const attachTotalPlantas = (units: UnidadCatastro[]) => {
    base.unidades = units
    const nums = units.map((u) => u.plantaNum).filter((n): n is number => n != null)
    base.totalPlantas = nums.length > 0 ? Math.max(...nums) : null
    return base
  }

  // Intentar primero por Referencia Catastral (DNPRC) si está disponible (mucho más preciso)
  if (geo.refCatastral) {
    const units = await consultarCatastroDNPRC(provincia, municipio, geo.refCatastral)
    if (units && units.length > 0) {
      return attachTotalPlantas(units)
    }
  }

  let numero = geo.portalNumber
  if (numero == null) {
    const mNum = direccion.match(/\b(\d{1,4})\b/)
    if (mNum) numero = parseInt(mNum[1])
  }
  if (numero == null) return base

  const siglaOrig = TIPVIA_SIGLA[_norm(geo.tip_via ?? "")] ?? "CL"
  const rawAddress = geo.address ?? ""
  const cleanStr = _norm(rawAddress)
  const rawParts = cleanStr.split("/").map((s) => s.trim()).filter(Boolean)

  const calleVariants = new Set<string>()
  for (const p of rawParts) {
    calleVariants.add(p)
    calleVariants.add(`${p} DEL`)
    calleVariants.add(`${p} DE LA`)
    calleVariants.add(`DEL ${p}`)
    calleVariants.add(`DE LA ${p}`)

    // Reemplazos de títulos habituales (DOCTOR -> DR, SANTA -> STA, etc.)
    const drStr = p.replace(/\bDOCTOR\b/g, "DR")
                   .replace(/\bDOCTORA\b/g, "DRA")
                   .replace(/\bPROFESOR\b/g, "PROF")
                   .replace(/\bARQUITECTO\b/g, "ARQ")
                   .replace(/\bINGENIERO\b/g, "ING")
                   .replace(/\bSANTA\b/g, "STA")
                   .replace(/\bGENERAL\b/g, "GEN")
    if (drStr !== p) {
      calleVariants.add(drStr)
      calleVariants.add(`${drStr} DEL`)
      calleVariants.add(`${drStr} DE LA`)
    }

    // Eliminación de títulos e iniciales
    const noTitle = p.replace(/^(DOCTOR|DOCTORA|DR|DRA|PROFESOR|PROF|ARQUITECTO|ARQ|INGENIERO|ING|GENERAL|GEN|SANTA|STA|SANT|SAN|DON|DOÑA|DE LA|DEL|DE|DES|DOS)\s+/, "")
    if (noTitle !== p) {
      calleVariants.add(noTitle)
      calleVariants.add(`${noTitle} DEL`)
      calleVariants.add(`${noTitle} DE LA`)
    }
  }

  const siglasToTry = [siglaOrig]
  for (const s of ["CL", "AV", "PZ", "GV", "PS", "CR", "RD"]) {
    if (!siglasToTry.includes(s)) siglasToTry.push(s)
  }

  const fallbacks: { provincia: string; municipio: string; sig: string; calleVar: string; fallbackNum: number }[] = []

  // FASE 1: Buscar coincidencia exacta con el portal pedido
  for (const calleVar of calleVariants) {
    for (const sig of siglasToTry) {
      const res = await consultarCatastroDNPLOC(provincia, municipio, sig, calleVar, numero)
      if (Array.isArray(res) && res.length > 0) {
        return attachTotalPlantas(res)
      } else if (res && typeof res === "object" && "fallbackNum" in res) {
        fallbacks.push({ provincia, municipio, sig, calleVar, fallbackNum: res.fallbackNum })
      }
    }
  }

  // FASE 2: Si no hubo fincas en el portal exacto, intentar el portal más cercano devuelto por el Catastro
  if (fallbacks.length > 0) {
    for (const fb of fallbacks) {
      const res = await consultarCatastroDNPLOC(fb.provincia, fb.municipio, fb.sig, fb.calleVar, fb.fallbackNum)
      if (Array.isArray(res) && res.length > 0) {
        return attachTotalPlantas(res)
      }
    }
  }

  return base
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
