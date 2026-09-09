"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface ApifyUso {
  gastado: number
  limite: number
  disponible: number
  permitido_hoy: number
  progreso_ciclo: number
  ciclo_fin: string | null
  seguir: boolean
  motivo: string
  actualizado: string
}

export type Operacion = "venta" | "alquiler"
export type TipoInmueble = "viviendas" | "locales" | "oficinas" | "garajes" | "trasteros" | "terrenos"
// "nombre" era el buscador por texto de Idealista. Ya no se ofrece (generaba URLs
// que el scraper no sabe recorrer), pero hay filas guardadas así.
export type TipoZona = "nombre" | "zona" | "url"

export interface ZonaScraper {
  id: string
  url: string
  nombre: string
  activa: boolean
  tipo: TipoZona
  search_name?: string | null
  coords?: [number, number][] | null
  ultima_ejecucion?: string | null
  ultimo_resultado?: number | null
  // Añadidos por la migración 004. Opcionales porque el código tiene que seguir
  // funcionando entre el despliegue y la ejecución del SQL.
  operacion?: Operacion | null
  tipo_inmueble?: TipoInmueble | null
  ventana_horas?: number | null
}

// `value` es jsonb: puede llegar como booleano/número reales o como string,
// según cómo se escribiera la fila. Se normaliza en la lectura.
function comoBool(v: unknown) {
  return v === true || v === "true"
}
function comoNum(v: unknown, porDefecto: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : porDefecto
}

export async function getAutoContactoConfig() {
  const supabase = await createAdminClient()

  const [{ data: settings }, { data: zonas }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["auto_contact_enabled", "wa_limite_diario", "apify_uso_mes"]),
    // `*` y no una lista de columnas: si se pidieran por nombre, la página entera
    // reventaría con un 400 en el hueco entre desplegar esto y ejecutar la
    // migración 004, que es justo cuando más se mira.
    supabase
      .from("scraper_zonas")
      .select("*")
      .order("activa", { ascending: false })
      .order("id"),
  ])

  const valor = (k: string) => settings?.find((s) => s.key === k)?.value

  const usoRaw = valor("apify_uso_mes")
  const uso = usoRaw && typeof usoRaw === "object" && "gastado" in usoRaw
    ? (usoRaw as unknown as ApifyUso)
    : null

  return {
    enabled: comoBool(valor("auto_contact_enabled")),
    limiteDiario: comoNum(valor("wa_limite_diario"), 25),
    uso,
    zonas: (zonas ?? []) as ZonaScraper[],
  }
}

export async function toggleAutoContacto(enabled: boolean) {
  const supabase = await createAdminClient()
  // Booleano jsonb real: n8n compara String(value) === 'true', que funciona con ambos.
  await supabase
    .from("app_settings")
    .upsert({ key: "auto_contact_enabled", value: enabled }, { onConflict: "key" })
  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Tope de WhatsApps por día, contando los automáticos y los que envía el agente
 * a mano. Es la única palanca que evita que WhatsApp bloquee el número: el
 * workflow de cola lo lee en cada turno y no envía nada por encima de él.
 */
export async function setLimiteDiario(limite: number) {
  const n = Math.max(1, Math.min(80, Math.round(limite)))
  const supabase = await createAdminClient()
  await supabase
    .from("app_settings")
    .upsert({ key: "wa_limite_diario", value: n }, { onConflict: "key" })
  revalidatePath("/captaciones")
  return { success: true, limite: n }
}

export interface NuevaZona {
  url: string
  nombre: string
  tipo?: TipoZona
  search_name?: string | null
  coords?: [number, number][] | null
  operacion?: Operacion
  tipo_inmueble?: TipoInmueble
  ventana_horas?: number
}

export async function agregarZona(z: NuevaZona) {
  const supabase = await createAdminClient()

  const fila: Record<string, unknown> = {
    url: z.url.trim(),
    nombre: z.nombre.trim(),
    activa: false,
    tipo: z.tipo ?? "zona",
    search_name: z.search_name ?? null,
    coords: z.coords ?? null,
    operacion: z.operacion ?? "venta",
    tipo_inmueble: z.tipo_inmueble ?? "viviendas",
    ventana_horas: z.ventana_horas ?? 24,
  }

  const { error } = await supabase.from("scraper_zonas").insert(fila)
  if (!error) {
    revalidatePath("/captaciones")
    return { success: true }
  }

  // Si aún no se ha ejecutado la migración 004, las tres columnas nuevas no
  // existen y PostgREST devuelve PGRST204. Se guarda la zona igual: la URL ya
  // lleva dentro la operación, el tipo y la ventana, así que el scraper la
  // procesa bien; sólo se pierden las etiquetas hasta que se ejecute el SQL.
  const faltanColumnas = error.code === "PGRST204" || /column .* does not exist/i.test(error.message)
  if (!faltanColumnas) return { error: error.message }

  const { error: error2 } = await supabase.from("scraper_zonas").insert({
    url: fila.url, nombre: fila.nombre, activa: false,
    tipo: fila.tipo, search_name: fila.search_name, coords: fila.coords,
  })
  if (error2) return { error: error2.message }
  revalidatePath("/captaciones")
  return { success: true, aviso: "Zona guardada, pero falta ejecutar la migración 004 para los ajustes por zona." }
}

/**
 * Ventana de publicación de una zona ya creada. Es el ajuste que más se toca:
 * un mercado fino (locales, garajes) con 24 h no devuelve nada, y uno grueso
 * (vivienda en Valencia) con 48 h duplica el gasto de Apify sin captar más.
 */
export async function setVentanaZona(id: string, horas: 24 | 48) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("scraper_zonas").update({ ventana_horas: horas }).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Varias zonas pueden estar activas a la vez: el captador las manda todas en un
 * único run de Apify, así que el coste de arranque del actor se paga una sola
 * vez. Antes se forzaba una única zona activa y eso limitaba las captaciones
 * sin ahorrar nada.
 */
export async function toggleZona(id: string, activa: boolean) {
  const supabase = await createAdminClient()
  const { error } = await supabase.from("scraper_zonas").update({ activa }).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function eliminarZona(id: string) {
  const supabase = await createAdminClient()
  await supabase.from("scraper_zonas").delete().eq("id", id)
  revalidatePath("/captaciones")
  return { success: true }
}

/** Cuántas captaciones esperan turno en la cola de WhatsApp y cuántas van hoy. */
export async function getEstadoCola() {
  const supabase = await createAdminClient()
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const [{ count: enCola }, { count: enviadasHoy }] = await Promise.all([
    supabase
      .from("captaciones")
      .select("id", { count: "exact", head: true })
      .is("estado_whatsapp", null)
      .is("contacto_lock_en", null)
      .not("telefono", "is", null)
      .eq("activo", true),
    supabase
      .from("captaciones")
      .select("id", { count: "exact", head: true })
      .gte("ultimo_contacto_en", hoy.toISOString()),
  ])

  return { enCola: enCola ?? 0, enviadasHoy: enviadasHoy ?? 0 }
}
