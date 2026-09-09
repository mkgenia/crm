"use server"

import { createClient, createAdminClient, createServiceClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { EstadoAgenda } from "@/types/captaciones"

export async function getCaptacionByTelefono(telefono: string) {
  const supabase = await createAdminClient()
  const digits = telefono.replace(/\D/g, "")
  const sufijo = digits.slice(-9)
  const { data } = await supabase
    .from("captaciones")
    .select("id, nombre, telefono, calle, barrio, precio, metros, habitaciones, imagen_url, url, raw_data")
    .ilike("telefono", `%${sufijo}`)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  return data as ({ id: number; nombre: string | null; telefono: string | null; calle: string | null; barrio: string | null; precio: number | null; metros: number | null; habitaciones: number | null; imagen_url: string | null; url: string | null; raw_data: Record<string, unknown> | null } | null)
}

export async function getCaptaciones(filtro?: string, search?: string, soloAgenteId?: string, isAdmin = false) {
  // Admins usan service role para bypassar RLS y ver todas las captaciones
  const supabase = isAdmin ? await createAdminClient() : await createClient()

  let query = supabase
    .from("captaciones")
    .select(`
      id, created_at, nombre, telefono, precio, precio_m2,
      barrio, calle, metros, habitaciones, banos, planta,
      tiene_ascensor, estado, estado_crm, estado_whatsapp, activo, imagen_url, imagenes,
      agente_id, fecha_agenda, recordatorio_fecha, notas_agenda, estado_agenda,
      operacion:raw_data->>operation,
      agente:perfiles!captaciones_agente_id_fkey(id, nombre, apellidos, avatar_url)
    `)
    .eq("activo", true)
    .order("created_at", { ascending: false })

  if (soloAgenteId) {
    query = query.eq("agente_id", soloAgenteId)
  }

  if (search) {
    query = query.or(`calle.ilike.%${search}%,barrio.ilike.%${search}%,nombre.ilike.%${search}%`)
  }

  if (filtro === "agendadas") {
    query = query.not("agente_id", "is", null)
  } else if (filtro === "sin_agente") {
    query = query.is("agente_id", null)
  } else if (filtro === "completadas") {
    query = query.eq("estado_agenda", "completado")
  } else if (filtro === "pendientes") {
    query = query.eq("estado_agenda", "pendiente").not("agente_id", "is", null)
  }

  const { data, error } = await query.limit(500)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getCaptacion(id: number) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select(`
      *,
      agente:perfiles!captaciones_agente_id_fkey(id, nombre, apellidos, avatar_url)
    `)
    .eq("id", id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getHistorial(captacionId: number) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("historial_cambios")
    .select("*")
    .eq("captacion_id", captacionId)
    .order("fecha", { ascending: false })
    .limit(50)
  return data ?? []
}

export async function getAgentes() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("perfiles")
    .select("id, nombre, apellidos, avatar_url, rol")
    .order("nombre")
  return data ?? []
}

export async function asignarAgenda(
  captacionId: number,
  payload: {
    agente_id: string | null
    fecha_agenda: string | null
    recordatorio_fecha: string | null
    notas_agenda: string | null
    estado_agenda: EstadoAgenda
  }
) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ ...payload, visto_en: null })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  // Sincronizar leads vinculados a esta captación
  if (payload.agente_id) {
    await supabase
      .from("leads")
      .update({ captado_por: payload.agente_id })
      .eq("captacion_id", captacionId)
  }

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return { success: true }
}

export async function actualizarEstadoAgenda(captacionId: number, estado: EstadoAgenda) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ estado_agenda: estado })
    .eq("id", captacionId)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Formato canónico del teléfono en todo el captador: 34XXXXXXXXX, solo dígitos.
 *
 * Es el que produce el scraper (`telefonoES`), el que deja la migración 003 en el
 * histórico y el que exige la cola de WhatsApp con su filtro `telefono=like.34*`.
 * Devuelve null si no es un fijo/móvil español, para no guardar un número que la
 * cola intentaría enviar y Evolution rechazaría.
 */
function normalizar(telefono: string | null): string | null {
  let d = String(telefono ?? "").replace(/\D/g, "")
  if (d.startsWith("00")) d = d.slice(2)
  if (d.length === 9) d = "34" + d
  return /^34[6-9]\d{8}$/.test(d) ? d : null
}

function phoneToJid(phone: string): string {
  const clean = normalizar(phone) ?? phone.replace(/[^\d]/g, "")
  return `${clean}@s.whatsapp.net`
}

/**
 * Garantiza que la captación tiene su lead espejo, creándolo si hace falta.
 *
 * El contacto manual no creaba ninguno, y el clasificador de respuestas (workflow 5)
 * actualiza el lead filtrando por captacion_id: sin fila, ese PATCH afectaba a cero
 * filas, PostgREST devolvía 204 y el propietario interesado no aparecía en /leads.
 */
async function asegurarLead(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  captacionId: number,
  nombre: string | null,
  telefono: string | null,
) {
  const { data: existente } = await supabase
    .from("leads")
    .select("id, estado")
    .eq("captacion_id", captacionId)
    .maybeSingle()

  if (existente) {
    if (existente.estado === "Nuevo") {
      await supabase.from("leads").update({ estado: "Contactado" }).eq("id", existente.id)
    }
    return
  }

  await supabase.from("leads").insert({
    nombre: nombre || "Propietario",
    telefono,
    fuente: "Captaciones",
    estado: "Contactado",
    captacion_id: captacionId,
    notas: "Contacto manual desde el panel de captaciones",
  })
}

function hasValidPhone(telefono: string | null): boolean {
  if (!telefono) return false
  const lower = telefono.toLowerCase()
  return !lower.includes("no disponible") && !lower.includes("privado") && telefono.trim() !== ""
}

function generateDefaultMessage(cap: { nombre: string | null; calle: string | null; barrio: string | null; precio: number | null }): string {
  const nombre = cap.nombre || "propietario"
  const calle = cap.calle || "su propiedad"
  const barrio = cap.barrio || "Valencia"
  const precio = cap.precio ? `${cap.precio.toLocaleString("es-ES")}€` : ""
  return `Hola ${nombre}, 👋\n\nLe contacto desde *Grupo Hogares*, empresa de gestión inmobiliaria en Valencia.\n\nHe visto su anuncio del piso en *${calle}*, ${barrio}${precio ? ` por ${precio}` : ""}.\n\nEstamos especializados en ayudar a propietarios a vender su vivienda de forma rápida y al mejor precio. ¿Tendría unos minutos para comentarle cómo podemos ayudarle?\n\nUn saludo 🏠`
}

export async function generarMensajeIA(captacionId: number): Promise<string> {
  const supabase = await createAdminClient()
  const { data: cap } = await supabase
    .from("captaciones")
    .select("nombre, calle, barrio, precio, url")
    .eq("id", captacionId)
    .single()

  if (!cap) return ""

  // Obtener nombre del agente logueado
  const { data: { user } } = await supabase.auth.getUser()
  let agenteName = "Josep"
  if (user) {
    const { data: perfil } = await supabase.from("perfiles").select("nombre, rol").eq("id", user.id).single()
    if (perfil?.rol === "Admin") agenteName = "Josep"
    else if (perfil?.nombre) agenteName = perfil.nombre
  }

  const n8nUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_IA_LEAD_GEN
  if (!n8nUrl) return generateDefaultMessage(cap)

  try {
    const res = await fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // El webhook de n8n exige esta cabecera desde el captador v2.
        ...(process.env.WEBHOOK_SECRET ? { "x-webhook-secret": process.env.WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({ captacion_id: captacionId, agent: agenteName }),
    })
    if (res.ok) {
      const raw = await res.text()
      try {
        const data = JSON.parse(raw)
        const msg = data.message ?? data.data?.message ?? (typeof data.data === "string" ? JSON.parse(data.data)?.message : null)
        if (msg) return msg
      } catch {}
    }
  } catch {}

  return generateDefaultMessage(cap)
}

export async function contactarCaptacion(captacionId: number, mensaje: string) {
  const supabase = await createAdminClient()

  const { data: cap } = await supabase
    .from("captaciones")
    .select("telefono, nombre")
    .eq("id", captacionId)
    .single()

  if (!cap?.telefono || !hasValidPhone(cap.telefono)) {
    return { error: "Esta captación no tiene teléfono disponible" }
  }

  const EVO_URL = process.env.EVO_API_URL
  const EVO_KEY = process.env.EVO_API_KEY
  const EVO_INSTANCE = process.env.EVO_INSTANCE
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) return { error: "Evolution API no configurada" }

  const jid = phoneToJid(cap.telefono)

  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({ number: jid, text: mensaje }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { error: `Evolution API: ${err}` }
  }

  // Actualizar estado captación.
  // contacto_lock_en saca la captación de la cola automática (si no, el captador
  // volvería a escribirle) y ultimo_contacto_en la hace contar en el tope diario
  // de WhatsApp, para que los envíos manuales y los automáticos compartan cupo.
  const ahora = new Date().toISOString()
  await supabase
    .from("captaciones")
    .update({
      estado_whatsapp: "Enviado",
      estado_crm: "Contactado",
      contacto_lock_en: ahora,
      ultimo_contacto_en: ahora,
    })
    .eq("id", captacionId)

  await asegurarLead(supabase, captacionId, cap.nombre, cap.telefono)
  revalidatePath("/leads")

  // Notificar n8n para activar modo humano
  const n8nWebhook = process.env.NEXT_PUBLIC_N8N_WEBHOOK_WHATSAPP_BOT
  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: EVO_INSTANCE,
        data: {
          key: { remoteJid: jid, fromMe: true, id: `CRM_${Date.now()}` },
          pushName: "Agente",
          message: { conversation: mensaje },
          messageTimestamp: Math.floor(Date.now() / 1000),
          source: "crm",
        },
        apikey: EVO_KEY,
      }),
    }).catch(() => {})
  }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: null,
    valor_nuevo: "Enviado",
  })

  revalidatePath("/captaciones")
  return { success: true, jid }
}

export async function contactarCaptacionConTelefono(captacionId: number, telefono: string, mensaje: string) {
  const supabase = await createAdminClient()

  // Se guarda normalizado, no como lo teclee el agente: si no, el clasificador de
  // respuestas (que busca por los últimos 9 dígitos) no encuentra la captación cuando
  // el propietario contesta.
  const jid = normalizar(telefono)
  if (!jid) return { error: "El teléfono no parece un número español válido" }

  const EVO_URL = process.env.EVO_API_URL
  const EVO_KEY = process.env.EVO_API_KEY
  const EVO_INSTANCE = process.env.EVO_INSTANCE
  if (!EVO_URL || !EVO_KEY || !EVO_INSTANCE) return { error: "Evolution API no configurada" }

  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({ number: jid, text: mensaje }),
  })

  if (!res.ok) {
    const err = await res.text()
    return { error: `Evolution API: ${err}` }
  }

  // Guardar teléfono + actualizar estados (ver nota en contactarCaptacion)
  const ahora = new Date().toISOString()
  const { data: actualizada } = await supabase
    .from("captaciones")
    .update({
      telefono: jid,
      estado_whatsapp: "Enviado",
      estado_crm: "Contactado",
      contacto_lock_en: ahora,
      ultimo_contacto_en: ahora,
    })
    .eq("id", captacionId)
    .select("nombre")
    .maybeSingle()

  await asegurarLead(supabase, captacionId, actualizada?.nombre ?? null, jid)
  revalidatePath("/leads")

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: null,
    valor_nuevo: "Enviado",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

/**
 * Devuelve la captación a la cola del captador automático.
 *
 * Casos típicos: quedó en "Sin WhatsApp" y el agente corrigió el teléfono, quedó en
 * "Duplicado" y se quiere escribir igualmente por el segundo anuncio, o el envío se
 * quedó a medias y la reserva sigue puesta.
 *
 * Hay que vaciar las TRES marcas: la cola exige `estado_whatsapp`, `contacto_lock_en`
 * y `ultimo_contacto_en` a null. Dejarse `ultimo_contacto_en` haría que el botón no
 * hiciera nada visible.
 */
export async function reintentarAutoContacto(captacionId: number) {
  const supabase = await createAdminClient()

  const { data: previa } = await supabase
    .from("captaciones")
    .select("estado_whatsapp")
    .eq("id", captacionId)
    .maybeSingle()

  const { error } = await supabase
    .from("captaciones")
    .update({ contacto_lock_en: null, ultimo_contacto_en: null, estado_whatsapp: null })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: previa?.estado_whatsapp ?? null,
    valor_nuevo: "En cola",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

export async function marcarRespondido(captacionId: number) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ estado_whatsapp: "Respondido" })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  await supabase.from("historial_cambios").insert({
    captacion_id: captacionId,
    campo: "estado_whatsapp",
    valor_anterior: "Enviado",
    valor_nuevo: "Respondido",
  })

  revalidatePath("/captaciones")
  return { success: true }
}

export async function eliminarCaptacion(captacionId: number) {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ activo: false })
    .eq("id", captacionId)

  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function getCaptacionesEliminadas() {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select("id, created_at, nombre, telefono, precio, barrio, calle, metros, habitaciones, imagen_url, imagenes, estado_crm, estado_whatsapp")
    .eq("activo", false)
    .order("created_at", { ascending: false })
  if (error) return []
  return data ?? []
}

export async function getCaptacionesEliminadasPorAgente(agenteId: string) {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("captaciones")
    .select("id, created_at, nombre, telefono, precio, barrio, calle, metros, habitaciones, imagen_url, imagenes, estado_crm, estado_whatsapp")
    .eq("activo", false)
    .eq("agente_id", agenteId)
    .order("created_at", { ascending: false })
  if (error) return []
  return data ?? []
}

export async function darDeBajaMasivo(ids: number[]) {
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ activo: false })
    .in("id", ids)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function asignarAgentesMasivo(ids: number[], agenteId: string) {
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ agente_id: agenteId, visto_en: null })
    .in("id", ids)
  if (error) return { error: error.message }

  // Asignar también los leads vinculados a estas captaciones
  await supabase
    .from("leads")
    .update({ captado_por: agenteId })
    .in("captacion_id", ids)

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return { success: true }
}

export async function getCaptacionesSinVer(agenteId: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("captaciones")
    .select("id, calle, barrio")
    .eq("agente_id", agenteId)
    .is("visto_en", null)
    .eq("activo", true)
  return data ?? []
}

export async function marcarCaptacionesVistas(ids: number[]) {
  if (!ids.length) return
  const supabase = await createAdminClient()
  await supabase
    .from("captaciones")
    .update({ visto_en: new Date().toISOString() })
    .in("id", ids)
}

export async function restaurarCaptaciones(ids: number[]) {
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("captaciones")
    .update({ activo: true })
    .in("id", ids)
  if (error) return { error: error.message }
  revalidatePath("/captaciones")
  return { success: true }
}

export async function eliminarDefinitivamente(ids: number[]) {
  if (!ids.length) return { success: true }
  const supabase = await createAdminClient()
  // Storage necesita service_role PURO: createAdminClient arrastra las cookies del
  // usuario y las políticas del bucket bloquean el borrado (dejaba carpetas huérfanas).
  const service = createServiceClient()

  // Limpiar Storage. Los errores no bloquean el borrado, pero sí se registran.
  const limpieza = await Promise.allSettled(
    ids.map(async (id) => {
      const { data: files, error: errList } = await service.storage
        .from("captaciones")
        .list(String(id), { limit: 1000 })
      if (errList) throw new Error(`list ${id}: ${errList.message}`)
      if (!files?.length) return 0
      const paths = files.map((f) => `${id}/${f.name}`)
      const { data: borrados, error: errDel } = await service.storage
        .from("captaciones")
        .remove(paths)
      if (errDel) throw new Error(`remove ${id}: ${errDel.message}`)
      // Sin permisos, Storage responde 200 con lista vacía: hay que detectarlo
      if (!borrados?.length) throw new Error(`remove ${id}: 0 de ${paths.length} archivos borrados (¿permisos?)`)
      return borrados.length
    })
  )

  const fallos = limpieza.filter((r) => r.status === "rejected")
  if (fallos.length) {
    console.error(
      `[eliminarDefinitivamente] Storage: ${fallos.length}/${ids.length} carpetas no se pudieron borrar.`,
      fallos.slice(0, 3).map((f) => (f as PromiseRejectedResult).reason?.message)
    )
  }

  // Borrar registros relacionados y la captación
  await supabase.from("historial_cambios").delete().in("captacion_id", ids)
  const { error } = await supabase.from("captaciones").delete().in("id", ids)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  return { success: true, storageErrores: fallos.length }
}

// Mapa estado_crm captación → estado lead
const CRM_TO_LEAD: Record<string, string> = {
  Contactado:  "Contactado",
  Interesado:  "Interesado",
  Propuesta:   "Interesado",
  Negociacion: "Interesado",
  Ganado:      "Ganado",
  Perdido:     "Perdido",
}

export async function actualizarEstadoCaptacion(captacionId: number, estadoCrm: string) {
  const supabase = await createAdminClient()

  const { data: actual } = await supabase
    .from("captaciones")
    .select("estado_crm")
    .eq("id", captacionId)
    .single()

  const { error } = await supabase
    .from("captaciones")
    .update({ estado_crm: estadoCrm })
    .eq("id", captacionId)

  if (error) return { error: error.message }

  if (actual?.estado_crm !== estadoCrm) {
    await supabase.from("historial_cambios").insert({
      captacion_id: captacionId,
      campo: "estado_crm",
      valor_anterior: actual?.estado_crm ?? null,
      valor_nuevo: estadoCrm,
    })

    // Sincronizar lead vinculado
    const leadEstado = CRM_TO_LEAD[estadoCrm]
    if (leadEstado) {
      await supabase
        .from("leads")
        .update({ estado: leadEstado })
        .eq("captacion_id", captacionId)
    }
  }

  revalidatePath("/captaciones")
  return { success: true }
}
