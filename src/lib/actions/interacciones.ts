"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"

/**
 * El historial de un contacto.
 *
 * Hasta ahora todo lo que pasaba con un lead se escribía como texto libre dentro
 * de `leads.notas`, y cada workflow la pisaba entera al escribir — la landing lo
 * hace literalmente en el paso 3, así que un lead que agenda visita pierde todo
 * lo anterior. Aquí cada cosa es una fila y nadie borra a nadie.
 */

export interface Interaccion {
  id: string
  lead_id: string | null
  captacion_id: number | null
  tipo: string
  direccion: "entrante" | "saliente" | "interna"
  canal: string | null
  resumen: string
  detalle: string | null
  agente_id: string | null
  automatica: boolean
  ocurrida_en: string
  meta: Record<string, unknown> | null
}

/** La línea de tiempo de un contacto, lo más reciente arriba. */
export async function getInteracciones(
  de: { leadId?: string; captacionId?: number },
  tope = 100
): Promise<{ interacciones: Interaccion[]; error?: string }> {
  await sesionActual()
  const supabase = await createAdminClient()

  let q = supabase
    .from("interacciones")
    .select("id, lead_id, captacion_id, tipo, direccion, canal, resumen, detalle, agente_id, automatica, ocurrida_en, meta")
    .order("ocurrida_en", { ascending: false })
    .limit(tope)

  // Una captación y su lead espejo son el mismo contacto contado dos veces: lo
  // que se apunta desde el chat cuelga del lead y lo que se apunta desde el
  // anuncio cuelga de la captación. Con el `if/else` de antes, la ficha del
  // anuncio enseñaba media historia y parecía que faltaban llamadas.
  let leadId = de.leadId
  if (!leadId && de.captacionId) {
    const { data: espejo } = await supabase
      .from("leads")
      .select("id, duplicado_de")
      .eq("captacion_id", de.captacionId)
      .order("fecha_creacion", { ascending: true })
      .limit(1)
      .maybeSingle()
    // COALESCE(duplicado_de, id), la misma regla que usa atender() en la 021:
    // si el lead se marcó como duplicado, la historia vive en el original.
    const fila = espejo as { id: string; duplicado_de: string | null } | null
    leadId = fila?.duplicado_de ?? fila?.id
  }

  const claves: string[] = []
  if (leadId) {
    // Los valores de `.or()` viajan dentro de un string que PostgREST parsea, no
    // parametrizados como en `.eq()`: un id con una coma dentro reescribiría el
    // filtro entero, y esto lo llama el navegador. Por eso se exige uuid.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      return { interacciones: [], error: "Ese lead no existe" }
    }
    claves.push(`lead_id.eq.${leadId}`)
  }
  if (de.captacionId) {
    if (!Number.isInteger(de.captacionId)) {
      return { interacciones: [], error: "Esa captación no existe" }
    }
    claves.push(`captacion_id.eq.${de.captacionId}`)
  }
  if (claves.length === 0) return { interacciones: [], error: "Falta el lead o la captación" }

  q = q.or(claves.join(","))

  const { data, error } = await q
  if (error) return { interacciones: [], error: error.message }
  return { interacciones: (data ?? []) as Interaccion[] }
}

/**
 * Apuntar algo a mano: una llamada, una nota, una visita.
 *
 * `automatica: false` porque la escribe una persona. La distinción importa al
 * leer la ficha: "te llamó Ana" y "el bot mandó un WhatsApp" no pesan igual.
 */
export async function apuntarInteraccion(entrada: {
  leadId?: string
  captacionId?: number
  tipo: string
  resumen: string
  detalle?: string
  direccion?: "entrante" | "saliente" | "interna"
  canal?: string
  ocurridaEn?: string
}): Promise<{ ok?: true; id?: string; error?: string }> {
  const sesion = await sesionActual()

  const resumen = entrada.resumen.trim()
  if (!resumen) return { error: "Escribe al menos una línea" }
  if (!entrada.leadId && !entrada.captacionId) return { error: "Falta el contacto" }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc("apuntar_interaccion", {
    p_lead_id: entrada.leadId ?? null,
    p_captacion_id: entrada.captacionId ?? null,
    p_tipo: entrada.tipo,
    p_resumen: resumen,
    p_direccion: entrada.direccion ?? "interna",
    p_canal: entrada.canal ?? "crm",
    p_detalle: entrada.detalle ?? null,
    p_agente_id: sesion.userId,
    p_automatica: false,
    p_ocurrida_en: entrada.ocurridaEn ?? null,
    p_meta: null,
  })

  if (error) return { error: error.message }

  revalidatePath("/leads")
  revalidatePath("/mensajes")
  revalidatePath("/captaciones")
  return { ok: true, id: data as string }
}

export async function borrarInteraccion(id: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: fila } = await supabase
    .from("interacciones").select("agente_id, automatica").eq("id", id).maybeSingle()
  if (!fila) return { error: "Esa anotación ya no existe" }

  // Las automáticas no se borran ni siendo administrador: son el registro de lo
  // que el sistema hizo de verdad, y una ficha donde se puede borrar lo que
  // molesta deja de servir para reconstruir qué pasó.
  if (fila.automatica) return { error: "Las anotaciones automáticas no se borran" }
  if (!sesion.isAdmin && fila.agente_id !== sesion.userId) {
    return { error: "Sólo puedes borrar tus propias anotaciones" }
  }

  const { error } = await supabase.from("interacciones").delete().eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/leads")
  revalidatePath("/mensajes")
  return { ok: true }
}

/**
 * Cambiar el estado de un lead dejando rastro.
 *
 * Sustituye a `actualizarEstadoLead`, que cambiaba el estado y no guardaba ni
 * quién ni cuándo ni por qué. Al pasar a Perdido se exige motivo: hay 135 leads
 * perdidos sin uno solo, y por eso hoy no se puede saber si se pierden por
 * precio o porque nadie los llamó.
 */
export async function cambiarEstadoLead(
  leadId: string,
  estado: string,
  motivoPerdida?: string | null
): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: antes } = await supabase
    .from("leads").select("estado, motivo_perdida").eq("id", leadId).maybeSingle()
  if (!antes) return { error: "Ese lead ya no existe" }
  if (antes.estado === estado && !motivoPerdida) return { ok: true }

  const esPerdido = estado === "Perdido"
  if (esPerdido && !motivoPerdida) return { error: "Di por qué se pierde" }

  const parche: Record<string, unknown> = { estado }
  if (esPerdido) {
    parche.motivo_perdida = motivoPerdida
    parche.perdido_en = new Date().toISOString()
  } else if (antes.estado === "Perdido") {
    // Se recupera: el motivo anterior deja de ser cierto.
    parche.motivo_perdida = null
    parche.perdido_en = null
  }

  const { error } = await supabase.from("leads").update(parche).eq("id", leadId)
  if (error) return { error: error.message }

  // El rastro se apunta después del cambio y sin cortar si falla: perder la
  // anotación es molesto, perder el cambio de estado por no poder anotarlo sería
  // absurdo.
  const { data: nombreMotivo } = motivoPerdida
    ? await supabase.from("catalogos").select("nombre")
        .eq("tipo", "motivo_perdida").eq("valor", motivoPerdida).maybeSingle()
    : { data: null }

  await supabase.rpc("apuntar_interaccion", {
    p_lead_id: leadId,
    p_captacion_id: null,
    p_tipo: "cambio_estado",
    p_resumen: `${antes.estado ?? "—"} → ${estado}`
      + (nombreMotivo?.nombre ? ` · ${nombreMotivo.nombre}` : ""),
    p_direccion: "interna",
    p_canal: "crm",
    p_detalle: null,
    p_agente_id: sesion.userId,
    p_automatica: false,
    p_ocurrida_en: null,
    p_meta: { desde: antes.estado, hasta: estado, motivo: motivoPerdida ?? null },
  })

  revalidatePath("/leads")
  revalidatePath("/mensajes")
  return { ok: true }
}

/** Cuántos leads se pierden por cada motivo. Para el panel de dirección. */
export async function getMotivosPerdida(): Promise<Array<{ motivo: string; total: number }>> {
  await sesionActual()
  const supabase = await createAdminClient()

  const { data } = await supabase
    .from("leads").select("motivo_perdida").eq("estado", "Perdido")

  const cuenta = new Map<string, number>()
  for (const l of data ?? []) {
    const k = l.motivo_perdida ?? "(sin motivo)"
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1)
  }
  return [...cuenta.entries()]
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Atender: un botón, y todo lo demás opcional.
 *
 * La ficha pedía agente + fecha + hora + recordatorio + estado antes de dejar
 * apuntar nada, y el resultado medido es que no se apunta: una sola nota a mano
 * en toda la historia y 735 de 737 captaciones con la agenda en "pendiente". El
 * agente cuelga el teléfono y tiene diez segundos de ganas; si le pides un
 * formulario se va al cuaderno. Así que guardar sin nota, sin resultado y sin
 * recordatorio TIENE que funcionar: es el caso de "no lo coge", el mayoritario.
 *
 * El trabajo va entero a la función SQL `atender` (migración 021) y no aquí:
 * son tres escrituras que se deshacen juntas si una falla —la interacción, el
 * recordatorio de `agenda` y el sello de la fila—, y eso es una transacción, no
 * tres viajes desde Node.
 */
export async function atender(entrada: {
  captacionId?: number
  leadId?: string
  nota?: string
  resultado?: string | null
  /** ISO en UTC. El cliente lo calcula en horario de Madrid antes de mandarlo. */
  recordarEn?: string | null
  tipo?: string
}): Promise<{ ok?: true; interaccionId?: string; agendaId?: string | null; error?: string }> {
  const sesion = await sesionActual()

  // `sesionActual` ya redirige al login cuando no hay nadie, pero la RPC es
  // SECURITY DEFINER y se salta las RLS: si esa redirección dejara de cortar,
  // esto escribiría en nombre de un agente vacío. La puerta se cierra dos veces.
  if (!sesion?.userId) return { error: "Se ha cerrado la sesión: vuelve a entrar" }

  if (!entrada.captacionId && !entrada.leadId) return { error: "Falta a quién se ha atendido" }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc("atender", {
    p_agente_id: sesion.userId,
    p_captacion_id: entrada.captacionId ?? null,
    // Los prospectos llegan en la 022; pasarlo no nulo hace reventar la función.
    p_prospecto_id: null,
    p_lead_id: entrada.leadId ?? null,
    p_nota: entrada.nota?.trim() || null,
    p_tipo: entrada.tipo ?? "llamada",
    p_resultado: entrada.resultado || null,
    p_recordar_en: entrada.recordarEn ?? null,
    // Sin título: la función lo compone con la primera línea de la nota, que es
    // justo lo que hace que no haya que pedirle un título a nadie.
    p_recordar_titulo: null,
    p_todo_el_dia: false,
  })

  if (error) return { error: error.message }

  const r = (data ?? {}) as { interaccion_id?: string; agenda_id?: string | null }

  // El recordatorio es una fila de `agenda`, así que /calendario también cambia
  // aunque aquí sólo se haya pulsado un botón en la ficha. Y /dashboard con él:
  // el bloque de "Mi día" se pinta en el servidor con getAgendaMes(), así que sin
  // esta línea el recordatorio recién creado no sale en la pantalla que el agente
  // abre por la mañana — justo donde tiene que salir. Es lo mismo que revalidan
  // las tres escrituras de lib/actions/agenda.ts.
  revalidatePath("/captaciones")
  revalidatePath("/calendario")
  revalidatePath("/dashboard")

  return { ok: true, interaccionId: r.interaccion_id, agendaId: r.agenda_id ?? null }
}
