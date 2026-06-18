"use server"

import { createClient, createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { EstadoAgenda } from "@/types/captaciones"

export async function getCaptacionByTelefono(telefono: string) {
  const supabase = await createAdminClient()
  const digits = telefono.replace(/\D/g, "")
  const sufijo = digits.slice(-9)
  const { data } = await supabase
    .from("captaciones")
    .select("id, nombre, telefono, calle, barrio, precio, metros, habitaciones, imagen_url, url")
    .ilike("telefono", `%${sufijo}`)
    .eq("activo", true)
    .limit(1)
    .maybeSingle()
  return data as ({ id: number; nombre: string | null; calle: string | null; barrio: string | null; precio: number | null; metros: number | null; habitaciones: number | null; imagen_url: string | null } | null)
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

function phoneToJid(phone: string): string {
  let clean = phone.replace(/[^\d]/g, "")
  if (clean.startsWith("00")) clean = clean.slice(2)
  if (clean.length === 9) clean = "34" + clean
  return `${clean}@s.whatsapp.net`
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

  const n8nUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_IA_LEAD_GEN
  if (n8nUrl && !n8nUrl.includes("tu-n8n")) {
    try {
      const res = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_message", captacion_id: captacionId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.message) return data.message
      }
    } catch {}
  }

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

  // Actualizar estado captación
  await supabase
    .from("captaciones")
    .update({ estado_whatsapp: "Enviado", estado_crm: "Contactado" })
    .eq("id", captacionId)

  // Lead vinculado → Contactado (solo si estaba en Nuevo)
  await supabase
    .from("leads")
    .update({ estado: "Contactado" })
    .eq("captacion_id", captacionId)
    .eq("estado", "Nuevo")

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

  // Limpiar Storage (errores no bloquean el delete)
  await Promise.allSettled(
    ids.map(async (id) => {
      const { data: files } = await supabase.storage.from("captaciones").list(String(id))
      if (files?.length) {
        const paths = files.map((f) => `${id}/${f.name}`)
        await supabase.storage.from("captaciones").remove(paths)
      }
    })
  )

  // Borrar registros relacionados y la captación
  await supabase.from("historial_cambios").delete().in("captacion_id", ids)
  const { error } = await supabase.from("captaciones").delete().in("id", ids)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  return { success: true }
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

  if (error) {
    return { error: error.message }
  }

  if (actual?.estado_crm !== estadoCrm) {
    await supabase.from("historial_cambios").insert({
      captacion_id: captacionId,
      campo: "estado_crm",
      valor_anterior: actual?.estado_crm ?? null,
      valor_nuevo: estadoCrm,
    })
  }

  revalidatePath("/captaciones")
  return { success: true }
}
