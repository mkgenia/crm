"use server"

import { createAdminClient } from "@/lib/supabase/server"

const EVO_URL = "https://test-evolution-api.pzkz6e.easypanel.host"

const INSTANCE_CONFIG: Record<string, { key: string; label: string }> = {
  demo: { key: "CB475A12852B-4DF3-86BA-4B8B379C7064", label: "Captaciones" },
  Demandas: { key: "39E7987E01C4-4117-94EF-9FBE92EDECF1", label: "Demandas" },
}


function evoHeaders(instance: string) {
  const key = INSTANCE_CONFIG[instance]?.key ?? process.env.EVO_API_KEY ?? ""
  return { "Content-Type": "application/json", apikey: key }
}

// Para enviar mensajes y leer chats individuales sigue usando la instancia demo (captaciones)
function evoConfig() {
  const url = EVO_URL
  const key = INSTANCE_CONFIG.demo.key
  const instance = "demo"
  return { url, key, instance }
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

// Extrae los últimos 9 dígitos (número local sin prefijo país)
function phoneLocal(phone: string) {
  return phone.slice(-9)
}

export async function getConversaciones(instance: string = "demo", filtroTelefonos?: string[]): Promise<Chat[]> {
  const res = await fetch(`${EVO_URL}/chat/findChats/${instance}`, {
    method: "POST",
    headers: evoHeaders(instance),
    body: JSON.stringify({}),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Evolution API error ${res.status}`)

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

  let filtered = chats
  if (filtroTelefonos?.length) {
    const normalized = filtroTelefonos.map(normalizePhone)
    filtered = chats.filter((c) =>
      normalized.some((t) => {
        const p = jidToPhone(c.remoteJid)
        return p.endsWith(t) || t.endsWith(p) || phoneLocal(p) === phoneLocal(t)
      })
    )
  }

  return enrichWithNames(filtered)
}

function looksLikePhone(s: string | null): boolean {
  if (!s) return true
  return /^[\d\s+\-().]+$/.test(s.trim())
}

async function enrichWithNames(chats: Chat[]): Promise<Chat[]> {
  const needsName = chats.filter((c) => looksLikePhone(c.name))
  if (!needsName.length) return chats

  // Recogemos los últimos 9 dígitos de cada teléfono para hacer el matching
  const locals = needsName.map((c) => phoneLocal(jidToPhone(c.remoteJid)))

  const supabase = await createAdminClient()
  const [leadsRes, captRes] = await Promise.all([
    supabase.from("leads").select("telefono, nombre"),
    supabase.from("captaciones").select("telefono, nombre"),
  ])

  // Mapa local9digits → nombre
  const nameMap = new Map<string, string>()
  for (const row of leadsRes.data ?? []) {
    if (row.telefono && row.nombre) {
      nameMap.set(phoneLocal(normalizePhone(row.telefono)), row.nombre)
    }
  }
  for (const row of captRes.data ?? []) {
    const local = phoneLocal(normalizePhone(row.telefono ?? ""))
    if (local && row.nombre && !nameMap.has(local)) nameMap.set(local, row.nombre)
  }

  return chats.map((c) => {
    if (!looksLikePhone(c.name)) return c
    const local = phoneLocal(jidToPhone(c.remoteJid))
    const name = nameMap.get(local) ?? c.name
    return { ...c, name }
  })
}

function parseMensajes(records: any[], fallbackJid: string): Mensaje[] {
  return records
    .filter((m) => {
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

async function fetchMessages(where: object, instance: string, limit = 100): Promise<any[]> {
  const res = await fetch(`${EVO_URL}/chat/findMessages/${instance}`, {
    method: "POST",
    headers: evoHeaders(instance),
    body: JSON.stringify({ where, limit }),
    cache: "no-store",
  })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : (data?.messages?.records ?? [])
}

export async function getMensajes(remoteJid: string, instance: string = "demo"): Promise<Mensaje[]> {
  const phoneBase = remoteJid.replace("@s.whatsapp.net", "")

  const [enviados, recibidos] = await Promise.all([
    fetchMessages({ key: { remoteJid } }, instance),
    fetchMessages({ key: { remoteJidAlt: `${phoneBase}@s.whatsapp.net` } }, instance),
  ])

  const todosRaw = [...enviados, ...recibidos]

  const vistos = new Set<string>()
  const unicos = todosRaw.filter((m) => {
    const id = m.key?.id ?? m.id
    if (vistos.has(id)) return false
    vistos.add(id)
    return true
  })

  return parseMensajes(unicos, remoteJid).sort((a, b) => a.timestamp - b.timestamp)
}

export async function enviarMensaje(remoteJid: string, texto: string, instance: string = "demo") {
  const number = jidToPhone(remoteJid)
  const res = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
    method: "POST",
    headers: evoHeaders(instance),
    body: JSON.stringify({ number, text: texto }),
  })
  if (!res.ok) {
    const err = await res.text()
    return { error: err }
  }
  return { success: true }
}

function telefonoAJid(telefono: string): string {
  const digits = telefono.replace(/\D/g, "")
  let numero = digits
  if (numero.startsWith("0034")) numero = numero.slice(2)
  if (!numero.startsWith("34")) numero = "34" + numero
  return `${numero}@s.whatsapp.net`
}

export async function getMensajesCaptacion(telefono: string): Promise<Mensaje[]> {
  if (!telefono) return []
  const jid = telefonoAJid(telefono)
  return getMensajes(jid, "demo")
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
