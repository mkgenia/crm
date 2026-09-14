"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import { valorDesdeNombre, type Catalogo } from "@/lib/catalogos"

/**
 * Lectura y escritura de los catálogos.
 *
 * Leer lo puede hacer cualquiera —el desplegable de estados le hace falta a un
 * agente para mover un lead—. Escribir es sólo del administrador: un agente que
 * renombra un estado se lo renombra a los seis.
 */

/** Todos los valores, incluidos los desactivados. Para el panel de administración. */
export async function getCatalogos(): Promise<{ catalogos: Catalogo[]; error?: string }> {
  await sesionActual()
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("catalogos")
    .select("id, tipo, valor, nombre, color, orden, activo, sistema")
    .order("tipo")
    .order("orden")

  if (error) return { catalogos: [], error: error.message }
  return { catalogos: (data ?? []) as Catalogo[] }
}

/**
 * Sólo los activos. Es lo que consumen los desplegables del resto del CRM.
 *
 * Va aparte de `getCatalogos` a propósito: si las pantallas normales leyeran
 * también los desactivados, un valor archivado seguiría ofreciéndose y no
 * habría forma de retirar uno.
 */
export async function getCatalogosActivos(): Promise<Catalogo[]> {
  await sesionActual()
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("catalogos")
    .select("id, tipo, valor, nombre, color, orden, activo, sistema")
    .eq("activo", true)
    .order("tipo")
    .order("orden")
  return (data ?? []) as Catalogo[]
}

export async function crearValor(entrada: {
  tipo: string
  nombre: string
  color?: string | null
}): Promise<{ ok?: true; id?: string; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador puede crear valores" }

  const nombre = entrada.nombre.trim()
  if (nombre.length < 2) return { error: "El nombre es demasiado corto" }

  const valor = valorDesdeNombre(nombre)
  if (!valor) return { error: "Ese nombre no da una clave válida" }

  const supabase = await createAdminClient()

  // El orden nuevo va al final de su lista, no al principio: quien añade un
  // estado casi nunca quiere que se cuele el primero.
  const { data: ultimo } = await supabase
    .from("catalogos")
    .select("orden")
    .eq("tipo", entrada.tipo)
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from("catalogos")
    .insert({
      tipo: entrada.tipo,
      valor,
      nombre,
      color: entrada.color ?? "gray",
      orden: (ultimo?.orden ?? 0) + 10,
      activo: true,
      sistema: false,
    })
    .select("id")
    .single()

  if (error) {
    // 23505 es la clave única (tipo, valor): ya existe uno que se llama igual.
    if (error.code === "23505") return { error: `Ya existe "${nombre}" en esa lista` }
    return { error: error.message }
  }

  revalidatePath("/configuracion/catalogos")
  return { ok: true, id: data.id }
}

/**
 * Renombrar y recolorear. El `valor` no se toca nunca.
 *
 * Es la diferencia entre poder cambiar de opinión y no poder: el `valor` está
 * escrito en miles de filas y en los workflows de n8n, el `nombre` sólo se ve.
 */
export async function actualizarValor(
  id: string,
  cambios: { nombre?: string; color?: string | null; orden?: number }
): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador puede editar los catálogos" }

  const parche: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (cambios.nombre !== undefined) {
    const n = cambios.nombre.trim()
    if (n.length < 2) return { error: "El nombre es demasiado corto" }
    parche.nombre = n
  }
  if (cambios.color !== undefined) parche.color = cambios.color
  if (cambios.orden !== undefined) parche.orden = cambios.orden

  const supabase = await createAdminClient()
  const { error } = await supabase.from("catalogos").update(parche).eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/configuracion/catalogos")
  return { ok: true }
}

/**
 * Archivar en vez de borrar.
 *
 * Un valor archivado deja de ofrecerse, pero las filas que ya lo tienen siguen
 * leyéndose. Borrarlo de verdad dejaría 134 leads con un estado que no existe.
 * Los de sistema no se archivan: hay workflows escribiéndolos ahora mismo.
 */
export async function archivarValor(id: string, activo: boolean): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador puede archivar valores" }

  const supabase = await createAdminClient()
  const { data: fila } = await supabase
    .from("catalogos")
    .select("sistema, nombre")
    .eq("id", id)
    .maybeSingle()

  if (!fila) return { error: "Ese valor ya no existe" }
  if (fila.sistema && !activo) {
    return { error: `"${fila.nombre}" lo escriben los workflows: no se puede archivar` }
  }

  const { error } = await supabase
    .from("catalogos")
    .update({ activo, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/configuracion/catalogos")
  return { ok: true }
}

/**
 * Cuántas filas usan cada valor. Sin esto, archivar es a ciegas.
 *
 * Lo cuenta la base de datos, no este código. La primera versión se traía las
 * filas de `leads`, `captaciones` y `lead_etiquetas` para sumarlas aquí, y
 * PostgREST corta en 1.000: con 1.034 leads el recuento ya salía corto y sin
 * avisar. En una pantalla cuya única función es decidir si algo se puede
 * archivar, un número más bajo del real es el peor error que puede dar.
 */
export async function getUsoCatalogos(): Promise<Record<string, number>> {
  await sesionActual()
  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc("uso_catalogos")
  if (error) {
    // Mejor sin números que con números mentirosos: la pantalla pinta un guion
    // cuando no hay recuento, y eso se lee como "no lo sé" en vez de "cero".
    console.error("uso_catalogos:", error.message)
    return {}
  }

  const uso: Record<string, number> = {}
  for (const fila of (data ?? []) as Array<{ clave: string; total: number }>) {
    uso[fila.clave] = Number(fila.total)
  }
  return uso
}

/** Poner o quitar una etiqueta a un lead. */
export async function marcarEtiqueta(
  leadId: string,
  etiquetaId: string,
  puesta: boolean
): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  if (puesta) {
    const { error } = await supabase
      .from("lead_etiquetas")
      .upsert({ lead_id: leadId, etiqueta_id: etiquetaId, puesta_por: sesion.userId })
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from("lead_etiquetas")
      .delete()
      .eq("lead_id", leadId)
      .eq("etiqueta_id", etiquetaId)
    if (error) return { error: error.message }
  }

  revalidatePath("/leads")
  return { ok: true }
}
