/**
 * Motor de valoración por SEMEJANZA (distancia de Gower ponderada).
 *
 * En vez de "mediana simple + porcentajes inventados", cada comparable pesa
 * según lo parecido que es al inmueble a valorar. Así el cálculo tiene en
 * cuenta TODAS las características disponibles de forma natural.
 *
 * Extensible: para añadir una variable nueva (orientación, vistas...) basta con
 * añadir su peso en PESOS y una línea en `similitud()`. Nada más.
 */

import type { ComparableInmueble } from "@/lib/actions/valorador"

// ─── Sujeto: el inmueble que se está valorando ────────────────────────────────
export interface Sujeto {
  /** flat | penthouse | duplex | studio | chalet ... */
  tipo?: string | null
  metros: number
  habitaciones?: number | null
  banos?: number | null
  condicion?: string | null // good | renew | newdevelopment
  plantaTipo?: string | null // bajo | intermedia | alta | atico
  ascensor?: boolean | null
  exterior?: boolean | null
  energia?: string | null // a..g
  piscina?: boolean
  jardin?: boolean
  trastero?: boolean
  parking?: boolean
  terraza?: boolean
  aire?: boolean
  lat?: number | null
  lng?: number | null
}

// ─── Pesos por variable (tunear aquí; añadir variables nuevas aquí) ───────────
export const PESOS: Record<string, number> = {
  tipo: 3,
  metros: 3,
  habitaciones: 2,
  banos: 1,
  condicion: 2.5,
  planta: 1,
  ascensor: 1.5,
  exterior: 1,
  energia: 0.8,
  piscina: 0.8,
  jardin: 0.6,
  trastero: 0.5,
  parking: 1,
  terraza: 0.8,
  aire: 0.6,
  distancia: 2,
}

// Escalas de referencia para variables numéricas (diferencia que da semejanza 0)
const ESCALA = { metros: 60, habitaciones: 3, banos: 2, distanciaM: 1500 }

const ENERGIA_ORDEN = ["a", "b", "c", "d", "e", "f", "g"]

function simNum(a: number, b: number, escala: number) {
  return Math.max(0, 1 - Math.abs(a - b) / escala)
}
function simBool(a: boolean, b: boolean) {
  return a === b ? 1 : 0
}
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Normaliza la planta del comparable ("4", "bj", "st") a nuestras categorías
export function plantaTipoDe(planta: string | null): string | null {
  if (planta == null) return null
  const p = String(planta).toLowerCase().trim()
  if (["bj", "b0", "pb", "ss", "st", "en", "0"].includes(p)) return "bajo"
  const n = parseInt(p, 10)
  if (isNaN(n)) return null
  if (n <= 0) return "bajo"
  if (n <= 3) return "intermedia"
  return "alta"
}

/**
 * Semejanza 0..1 entre el sujeto y un comparable.
 * Solo cuentan las variables presentes en AMBOS (criterio de Gower), de modo
 * que un comparable con pocos datos no queda injustamente penalizado.
 */
export function similitud(sujeto: Sujeto, c: ComparableInmueble): number {
  let suma = 0
  let pesos = 0
  const add = (peso: number, sim: number) => { suma += peso * sim; pesos += peso }

  // Tipo de inmueble: piso/ático/dúplex/estudio/chalet.
  // Un chalet no es comparable con un piso; ático y dúplex sí se parecen algo.
  if (sujeto.tipo && c.tipo_detallado) {
    const a = sujeto.tipo.toLowerCase(), b = c.tipo_detallado.toLowerCase()
    const afines = new Set(["flat", "penthouse", "duplex", "studio"])
    const sim = a === b ? 1 : (afines.has(a) && afines.has(b) ? 0.55 : 0)
    add(PESOS.tipo, sim)
  }

  // Numéricas
  if (sujeto.metros > 0 && c.metros > 0) add(PESOS.metros, simNum(sujeto.metros, c.metros, ESCALA.metros))
  if (sujeto.habitaciones != null && c.habitaciones != null)
    add(PESOS.habitaciones, simNum(sujeto.habitaciones, c.habitaciones, ESCALA.habitaciones))
  if (sujeto.banos != null && c.banos != null)
    add(PESOS.banos, simNum(sujeto.banos, c.banos, ESCALA.banos))

  // Categóricas
  if (sujeto.condicion && c.estado_conservacion)
    add(PESOS.condicion, sujeto.condicion === c.estado_conservacion ? 1 : 0)

  const plantaComp = plantaTipoDe(c.planta)
  if (sujeto.plantaTipo && plantaComp) {
    // "atico" se parece más a "alta" que a "bajo"
    const eq = sujeto.plantaTipo === plantaComp
      || (sujeto.plantaTipo === "atico" && plantaComp === "alta")
    add(PESOS.planta, eq ? 1 : 0)
  }

  // Energía como ordinal (A..G): más cerca en la escala, más parecido
  const eS = sujeto.energia?.toLowerCase()
  const eC = c.energia?.toLowerCase()
  if (eS && eC && ENERGIA_ORDEN.includes(eS) && ENERGIA_ORDEN.includes(eC)) {
    const d = Math.abs(ENERGIA_ORDEN.indexOf(eS) - ENERGIA_ORDEN.indexOf(eC))
    add(PESOS.energia, 1 - d / (ENERGIA_ORDEN.length - 1))
  }

  // Booleanas
  const pares: [keyof Sujeto, boolean | null, number][] = [
    ["ascensor", c.ascensor, PESOS.ascensor],
    ["exterior", c.exterior, PESOS.exterior],
    ["piscina", c.piscina, PESOS.piscina],
    ["jardin", c.jardin, PESOS.jardin],
    ["trastero", c.trastero, PESOS.trastero],
    ["parking", c.parking, PESOS.parking],
    ["terraza", c.terraza, PESOS.terraza],
    ["aire", c.aire, PESOS.aire],
  ]
  for (const [k, valComp, peso] of pares) {
    const valSuj = sujeto[k] as boolean | null | undefined
    if (valSuj != null && valComp != null) add(peso, simBool(!!valSuj, !!valComp))
  }

  // Proximidad geográfica
  if (sujeto.lat != null && sujeto.lng != null && c.lat != null && c.lng != null) {
    const d = haversine(sujeto.lat, sujeto.lng, c.lat, c.lng)
    add(PESOS.distancia, Math.max(0, 1 - d / ESCALA.distanciaM))
  }

  return pesos > 0 ? suma / pesos : 0
}

// ─── Ajuste hedónico ──────────────────────────────────────────────────────────
/**
 * Valor de mercado de cada atributo (% sobre el precio). Se usa para "normalizar"
 * el precio de un comparable como si tuviera las mismas características que el
 * inmueble valorado (paired sales analysis).
 */
export const VALOR_ATRIBUTO: Record<string, number> = {
  parking: 0.06,
  terraza: 0.04,
  piscina: 0.05,
  jardin: 0.03,
  trastero: 0.02,
  aire: 0.02,
  exterior: 0.04,
  ascensor: 0.07,
}
const COND_VALOR: Record<string, number> = {
  newdevelopment: 1.12,
  good: 1.0,
  renew: 0.84,
}
// Prima/penalización por letra energética respecto a la media (D)
const ENERGIA_VALOR: Record<string, number> = {
  a: 1.06, b: 1.04, c: 1.02, d: 1.0, e: 0.99, f: 0.98, g: 0.97,
}

/** Multiplicador de "calidad" de un conjunto de atributos. */
function factorCalidad(o: {
  parking?: boolean | null; terraza?: boolean | null; piscina?: boolean | null
  jardin?: boolean | null; trastero?: boolean | null; aire?: boolean | null
  exterior?: boolean | null; ascensor?: boolean | null
  condicion?: string | null; energia?: string | null
}): number {
  let f = 1
  for (const k of Object.keys(VALOR_ATRIBUTO)) {
    const v = (o as Record<string, unknown>)[k]
    if (v === true) f *= 1 + VALOR_ATRIBUTO[k]
  }
  if (o.condicion) f *= COND_VALOR[o.condicion] ?? 1
  const e = o.energia?.toLowerCase()
  if (e && ENERGIA_VALOR[e]) f *= ENERGIA_VALOR[e]
  return f
}

/**
 * Normaliza el €/m² de un comparable a las características del sujeto.
 * Si el comparable tiene parking y el sujeto no, su precio se corrige a la baja.
 * Solo se ajustan los atributos con dato en el comparable (no inventamos).
 */
export function precioAjustado(sujeto: Sujeto, c: ComparableInmueble): number {
  const attrs = ["parking", "terraza", "piscina", "jardin", "trastero", "aire", "exterior", "ascensor"] as const
  const sujAttr: Record<string, boolean | null> = {}
  const compAttr: Record<string, boolean | null> = {}
  for (const k of attrs) {
    const vc = c[k] as boolean | null
    if (vc == null) continue // sin dato en el comparable → no ajustamos
    compAttr[k] = vc
    sujAttr[k] = (sujeto[k] as boolean | undefined) ?? false
  }
  const sujCond = sujeto.condicion ?? null
  const compCond = c.estado_conservacion ?? null
  const sujEner = sujeto.energia ?? null
  const compEner = c.energia ?? null

  const fSuj = factorCalidad({
    ...sujAttr,
    condicion: compCond ? sujCond : null,
    energia: compEner ? sujEner : null,
  })
  const fComp = factorCalidad({
    ...compAttr,
    condicion: compCond ? compCond : null,
    energia: compEner ? compEner : null,
  })
  if (fComp <= 0) return c.precio_m2
  // Acotado para que un ajuste extremo no dispare el precio
  const ratio = Math.min(1.35, Math.max(0.7, fSuj / fComp))
  return c.precio_m2 * ratio
}

// ─── Percentil ponderado (con interpolación → sensible a los pesos) ───────────
function percentilPonderado(items: { valor: number; peso: number }[], p: number): number {
  const orden = [...items].sort((a, b) => a.valor - b.valor)
  const total = orden.reduce((s, i) => s + i.peso, 0)
  if (total <= 0) return orden.length ? orden[Math.floor(orden.length / 2)].valor : 0
  const objetivo = total * p
  let acum = 0
  for (let i = 0; i < orden.length; i++) {
    const prev = acum
    acum += orden[i].peso
    if (acum >= objetivo) {
      // Interpolación lineal dentro del tramo para evitar saltos discretos
      if (i === 0 || orden[i].peso === 0) return orden[i].valor
      const t = (objetivo - prev) / orden[i].peso
      return orden[i - 1].valor + (orden[i].valor - orden[i - 1].valor) * Math.min(1, Math.max(0, t))
    }
  }
  return orden[orden.length - 1].valor
}

export interface ResultadoSemejanza {
  p25: number
  mediana: number
  p75: number
  muestraUsada: number
  similitudMedia: number
  /** 0..1 — cuánta confianza merece la estimación (muestra + parecido) */
  confianza: number
  /** Desviación de la estimación ponderada frente a la mediana simple, en % */
  ajustePct: number
  /** Semejanza por comparable, para pintarla en la UI */
  scores: Map<number, number>
}

/**
 * Estima los percentiles de €/m² ponderando cada comparable por su semejanza.
 * `minSimilitud` descarta los que no se parecen en nada.
 */
export function estimarPorSemejanza(
  sujeto: Sujeto,
  comparables: ComparableInmueble[],
  opts: { minSimilitud?: number; excluidos?: Set<number> } = {}
): ResultadoSemejanza | null {
  const { minSimilitud = 0.3, excluidos } = opts

  const scores = new Map<number, number>()
  const candidatos: { valor: number; peso: number; sim: number }[] = []

  for (const c of comparables) {
    if (!c.precio_m2 || c.precio_m2 <= 0) continue
    const sim = similitud(sujeto, c)
    scores.set(c.id, sim)
    if (excluidos?.has(c.id)) continue
    // Precio normalizado a las características del sujeto (ajuste hedónico)
    candidatos.push({ valor: precioAjustado(sujeto, c), peso: sim, sim })
  }
  if (!candidatos.length) return null

  // Nos quedamos con los razonablemente parecidos; si hay muy pocos, relajamos
  let usados = candidatos.filter((c) => c.sim >= minSimilitud)
  if (usados.length < 5) usados = [...candidatos].sort((a, b) => b.sim - a.sim).slice(0, 10)

  // Peso = similitud^2 → prima claramente a los muy parecidos
  const ponderados = usados.map((u) => ({ valor: u.valor, peso: Math.max(0.01, u.sim ** 2) }))

  const mediana = percentilPonderado(ponderados, 0.5)
  const p25 = percentilPonderado(ponderados, 0.25)
  const p75 = percentilPonderado(ponderados, 0.75)

  const simMedia = usados.reduce((s, u) => s + u.sim, 0) / usados.length

  // Mediana simple (sin ponderar) para medir cuánto ha ajustado la semejanza
  const simples = [...usados.map((u) => u.valor)].sort((a, b) => a - b)
  const medianaSimple = simples[Math.floor(simples.length / 2)] || mediana
  const ajustePct = medianaSimple > 0 ? ((mediana - medianaSimple) / medianaSimple) * 100 : 0

  // Confianza: mezcla de tamaño de muestra y parecido medio
  const factorMuestra = Math.min(1, usados.length / 25)
  const confianza = Math.max(0, Math.min(1, factorMuestra * 0.5 + simMedia * 0.5))

  return {
    p25: Math.round(p25),
    mediana: Math.round(mediana),
    p75: Math.round(p75),
    muestraUsada: usados.length,
    similitudMedia: simMedia,
    confianza,
    ajustePct,
    scores,
  }
}
