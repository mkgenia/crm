"use server"

import { createAdminClient } from "@/lib/supabase/server"

function evoConfig() {
  const url = process.env.EVO_API_URL
  const key = process.env.EVO_API_KEY
  const instance = process.env.EVO_INSTANCE
  if (!url || !key || !instance) throw new Error("Evolution API no configurada (EVO_API_URL, EVO_API_KEY, EVO_INSTANCE)")
  return { url, key, instance }
}

function evoHeaders(key: string) {
  return { "Content-Type": "application/json", apikey: key }
}

export interface Chat {
  remoteJid: string
  name: string | null
  lastMessage: string | null
  lastMessageTime: number | null
  unreadCount: number
  profilePicUrl: string | null
}

export interface Mensaje {
  id: string
  remoteJid: string
  fromMe: boolean
  body: string
  timestamp: number
  status: string | null
  mediaUrl: string | null
  mediaType: string | null
}

function normalizePhone(telefono: string) {
  return telefono.replace(/\D/g, "")
}

function jidToPhone(jid: string) {
  return jid.split("@")[0]
}

export async function getConversaciones(filtroTelefonos?: string[]): Promise<Chat[]> {
  const { url, key, instance } = evoConfig()
  const res = await fetch(`${url}/chat/findChats/${instance}`, {
    method: "POST",
    headers: evoHeaders(key),
    body: JSON.stringify({}),
    cache: "no-store",
  })
  if (!res.ok) return []

  const raw: any[] = await res.json()

  const chats: Chat[] = raw
    .filter((c) => c.remoteJid?.endsWith("@s.whatsapp.net"))
    .map((c) => ({
      remoteJid: c.remoteJid,
      name: c.name ?? c.pushName ?? null,
      lastMessage: c.lastMessage?.message?.conversation ?? c.lastMessage?.message?.extendedTextMessage?.text ?? null,
      lastMessageTime: c.lastMessage?.messageTimestamp ?? null,
      unreadCount: c.unreadCount ?? 0,
      profilePicUrl: c.profilePicUrl ?? null,
    }))

  if (filtroTelefonos?.length) {
    const normalized = filtroTelefonos.map(normalizePhone)
    return chats.filter((c) => normalized.some((t) => jidToPhone(c.remoteJid).endsWith(t) || t.endsWith(jidToPhone(c.remoteJid))))
  }

  return chats
}

function parseMensajes(records: any[], fallbackJid: string): Mensaje[] {
  return records
    .filter((m) => {
      // Ignorar reacciones y tipos sin texto visible
      const tipo = m.messageType ?? ""
      return !["reactionMessage", "protocolMessage", "senderKeyDistributionMessage"].includes(tipo)
    })
    .map((m) => {
      const body =
        m.message?.conversation ??
        m.message?.extendedTextMessage?.text ??
        m.message?.imageMessage?.caption ??
        m.message?.videoMessage?.caption ??
        (m.message?.audioMessage ? "[audio]" :
        m.message?.documentMessage ? "[documento]" :
        m.message?.stickerMessage ? "[sticker]" :
        "[archivo]")
      return {
        id: m.key?.id ?? m.id,
        remoteJid: m.key?.remoteJidAlt ?? m.key?.remoteJid ?? fallbackJid,
        fromMe: m.key?.fromMe ?? false,
        body,
        timestamp: m.messageTimestamp ?? 0,
        status: m.status ?? null,
        mediaUrl: m.message?.imageMessage?.url ?? m.message?.videoMessage?.url ?? null,
        mediaType: m.message?.imageMessage ? "image" : m.message?.videoMessage ? "video" : null,
      }
    })
}

async function fetchMessages(where: object, limit = 100): Promise<any[]> {
  const { url, key, instance } = evoConfig()
  const res = await fetch(`${url}/chat/findMessages/${instance}`, {
    method: "POST",
    headers: evoHeaders(key),
    body: JSON.stringify({ where, limit }),
    cache: "no-store",
  })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : (data?.messages?.records ?? [])
}

export async function getMensajes(remoteJid: string): Promise<Mensaje[]> {
  // WhatsApp nuevo usa @lid para mensajes recibidos — hay que consultar ambos formatos
  const phoneBase = remoteJid.replace("@s.whatsapp.net", "")

  const [enviados, recibidos] = await Promise.all([
    fetchMessages({ key: { remoteJid } }),
    fetchMessages({ key: { remoteJidAlt: `${phoneBase}@s.whatsapp.net` } }),
  ])

  const todosRaw = [...enviados, ...recibidos]

  // Deduplicar por key.id
  const vistos = new Set<string>()
  const unicos = todosRaw.filter((m) => {
    const id = m.key?.id ?? m.id
    if (vistos.has(id)) return false
    vistos.add(id)
    return true
  })

  return parseMensajes(unicos, remoteJid).sort((a, b) => a.timestamp - b.timestamp)
}

export async function enviarMensaje(remoteJid: string, texto: string) {
  const { url, key, instance } = evoConfig()
  const number = jidToPhone(remoteJid)
  const res = await fetch(`${url}/message/sendText/${instance}`, {
    method: "POST",
    headers: evoHeaders(key),
    body: JSON.stringify({ number, text: texto }),
  })
  if (!res.ok) {
    const err = await res.text()
    return { error: err }
  }
  return { success: true }
}

// Convierte el teléfono de una captación al JID de WhatsApp
function telefonoAJid(telefono: string): string {
  const digits = telefono.replace(/\D/g, "")
  // Normalizar: asegurar prefijo 34 (España)
  let numero = digits
  if (numero.startsWith("0034")) numero = numero.slice(2)
  if (!numero.startsWith("34")) numero = "34" + numero
  return `${numero}@s.whatsapp.net`
}

export async function getMensajesCaptacion(telefono: string): Promise<Mensaje[]> {
  if (!telefono) return []
  const jid = telefonoAJid(telefono)
  return getMensajes(jid)
}

export async function getTelefonosAgente(agenteId: string): Promise<string[]> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("captaciones")
    .select("telefono")
    .eq("agente_id", agenteId)
    .eq("activo", true)
    .not("telefono", "is", null)
  return (data ?? []).map((r) => r.telefono as string)
}
