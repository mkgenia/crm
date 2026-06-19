"use client"

import { useState, useEffect, useRef, useTransition } from "react"
import { getMensajes, enviarMensaje, type Chat, type Mensaje } from "@/lib/actions/mensajes"
import { getLeadByPhone } from "@/lib/actions/leads"
import { Send, Loader2, Phone, RefreshCw, ExternalLink, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { LeadPanel } from "./lead-panel"

interface Captacion {
  id: number
  nombre: string | null
  telefono: string | null
  calle: string | null
  barrio: string | null
  precio: number | null
  metros: number | null
  habitaciones: number | null
  imagen_url: string | null
  url: string | null
}

function Avatar({ name, url, size = "md" }: { name: string | null; url: string | null; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm"
  if (url) return <img src={url} alt="" className={cn("rounded-full object-cover shrink-0", dim)} />
  const init = (name ?? "?").charAt(0).toUpperCase()
  return (
    <div className={cn("rounded-full flex items-center justify-center font-bold shrink-0 bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white", dim)}>
      {init}
    </div>
  )
}

function fechaLabel(timestamp: number): string {
  const fecha = new Date(timestamp * 1000)
  const hoy = new Date()
  const ayer = new Date(hoy)
  ayer.setDate(ayer.getDate() - 1)

  const mismoDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (mismoDay(fecha, hoy)) return "Hoy"
  if (mismoDay(fecha, ayer)) return "Ayer"
  return fecha.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })
}

function dayKey(timestamp: number): string {
  const d = new Date(timestamp * 1000)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-muted-foreground font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

function MensajeBubble({ msg }: { msg: Mensaje }) {
  const fecha = new Date(msg.timestamp * 1000)
  const hora = fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })

  return (
    <div className={cn("flex gap-2 max-w-[75%]", msg.fromMe ? "ml-auto flex-row-reverse" : "mr-auto")}>
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          msg.fromMe
            ? "rounded-tr-sm bg-violet-500/20 text-foreground border border-violet-500/20"
            : "rounded-tl-sm bg-card border border-border text-foreground"
        )}
      >
        {msg.mediaUrl && (
          <img src={msg.mediaUrl} alt="" className="rounded-lg mb-2 max-w-full" />
        )}
        <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
        <p className={cn("text-[10px] mt-1", msg.fromMe ? "text-violet-400/70 text-right" : "text-muted-foreground")}>{hora}</p>
      </div>
    </div>
  )
}

interface Props {
  chat: Chat
  captacion?: Captacion | null
  onVerCaptacion?: () => void
  instance?: string
}

export function ChatView({ chat, captacion, onVerCaptacion, instance = "demo" }: Props) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [texto, setTexto] = useState("")
  const [sending, startSending] = useTransition()
  const [lead, setLead] = useState<Awaited<ReturnType<typeof getLeadByPhone>>>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function cargarMensajes() {
    setLoadingMsgs(true)
    try {
      const data = await getMensajes(chat.remoteJid, instance)
      setMensajes(data)
    } catch {
      toast.error("Error al cargar mensajes")
    } finally {
      setLoadingMsgs(false)
    }
  }

  useEffect(() => {
    cargarMensajes()
    const phone = chat.remoteJid.split("@")[0]
    getLeadByPhone(phone).then(setLead).catch(() => setLead(null))
  }, [chat.remoteJid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [mensajes])

  function handleEnviar() {
    if (!texto.trim()) return
    const msg = texto.trim()
    setTexto("")
    startSending(async () => {
      const optimistic: Mensaje = {
        id: `opt-${Date.now()}`,
        remoteJid: chat.remoteJid,
        fromMe: true,
        body: msg,
        timestamp: Date.now() / 1000,
        status: null,
        mediaUrl: null,
        mediaType: null,
      }
      setMensajes((prev) => [...prev, optimistic])
      const res = await enviarMensaje(chat.remoteJid, msg, instance)
      if (res.error) {
        toast.error("Error al enviar mensaje")
        setMensajes((prev) => prev.filter((m) => m.id !== optimistic.id))
      }
    })
  }

  const phone = chat.remoteJid.split("@")[0]

  return (
    <div className="flex flex-col h-full">
      {/* Header del chat */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-card shrink-0">
        <Avatar name={chat.name} url={chat.profilePicUrl} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{chat.name ?? phone}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="h-3 w-3" /> +{phone}
          </p>
        </div>
        <button
          onClick={cargarMensajes}
          disabled={loadingMsgs}
          className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", loadingMsgs && "animate-spin")} />
        </button>
      </div>

      {/* Banner captación */}
      {captacion && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-amber-500/8 border-b border-amber-500/20">
          {captacion.imagen_url && (
            <img src={captacion.imagen_url} alt="" className="h-10 w-14 rounded-md object-cover shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {captacion.calle ?? captacion.nombre ?? "Captación"}
              {captacion.barrio ? ` · ${captacion.barrio}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                captacion.precio ? `${captacion.precio.toLocaleString("es-ES")} €` : null,
                captacion.metros ? `${captacion.metros} m²` : null,
                captacion.habitaciones ? `${captacion.habitaciones} hab.` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                const partes = [
                  captacion.nombre ? `Propietario: ${captacion.nombre}` : null,
                  captacion.telefono ? `Tel: ${captacion.telefono}` : null,
                  (captacion.calle || captacion.barrio) ? `Dirección: ${[captacion.calle, captacion.barrio].filter(Boolean).join(", ")}` : null,
                  captacion.url ? `Idealista: ${captacion.url}` : null,
                ].filter(Boolean).join("\n")
                navigator.clipboard.writeText(partes)
                toast.success("Ficha copiada")
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border hover:bg-muted transition-colors"
            >
              <Copy className="h-3.5 w-3.5" /> Copiar ficha
            </button>
            <button
              onClick={onVerCaptacion}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-white transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Ver captación
            </button>
          </div>
        </div>
      )}

      {/* Lead panel */}
      <LeadPanel
        lead={lead as any}
        chatName={chat.name}
        phone={chat.remoteJid.split("@")[0]}
        onLeadCreated={(l) => setLead(l as any)}
      />

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loadingMsgs ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mensajes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-20">Sin mensajes</p>
        ) : (
          (() => {
            let lastDay = ""
            return mensajes.map((m) => {
              const key = dayKey(m.timestamp)
              const showSep = key !== lastDay
              lastDay = key
              return (
                <div key={m.id}>
                  {showSep && <DateSeparator label={fechaLabel(m.timestamp)} />}
                  <MensajeBubble msg={m} />
                </div>
              )
            })
          })()
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border px-4 py-3 bg-card">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar() }
            }}
            placeholder="Escribe un mensaje..."
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring max-h-32"
          />
          <button
            onClick={handleEnviar}
            disabled={!texto.trim() || sending}
            className="h-10 w-10 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-colors"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Send className="h-4 w-4 text-white" />}
          </button>
        </div>
      </div>
    </div>
  )
}
