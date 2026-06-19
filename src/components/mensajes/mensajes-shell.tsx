"use client"

import { useState, useEffect } from "react"
import { ChatView } from "./chat-view"
import { DetailPanel } from "@/components/captaciones/detail-panel"
import { MessageSquare, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/actions/mensajes"
import type { INSTANCIAS } from "@/lib/instancias"
import { getCaptacionByTelefono } from "@/lib/actions/captaciones"

function fmtTime(ts: number | null) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })
}

function ChatItem({ chat, active, onClick }: { chat: Chat; active: boolean; onClick: () => void }) {
  const phone = chat.remoteJid.split("@")[0]
  const displayName = chat.name && !/^[\d\s+\-().]+$/.test(chat.name.trim()) ? chat.name : `+${phone}`
  const init = displayName.charAt(0).toUpperCase()

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors text-left",
        active && "bg-violet-500/10 border-r-2 border-violet-500"
      )}
    >
      {chat.profilePicUrl ? (
        <img src={chat.profilePicUrl} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white">
          {init}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn("text-sm font-medium truncate", active ? "text-violet-500" : "text-foreground")}>
            {displayName}
          </p>
          <span className="text-[10px] text-muted-foreground shrink-0">{fmtTime(chat.lastMessageTime)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{chat.lastMessage ?? "Sin mensajes"}</p>
          {chat.unreadCount > 0 && (
            <span className="text-[10px] font-bold bg-violet-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

interface Props {
  chatsPorInstancia: Record<string, Chat[]>
  instancias: typeof INSTANCIAS[number][]
}

export function MensajesShell({ chatsPorInstancia, instancias }: Props) {
  const [activeInstance, setActiveInstance] = useState(instancias[0]?.id ?? "demo")
  const [localChats, setLocalChats] = useState(chatsPorInstancia)
  const [selected, setSelected] = useState<Chat | null>(null)
  const [search, setSearch] = useState("")
  const [captacion, setCaptacion] = useState<Awaited<ReturnType<typeof getCaptacionByTelefono>>>(null)
  const [openCaptacionId, setOpenCaptacionId] = useState<number | null>(null)

  const chats = localChats[activeInstance] ?? []

  // Reset selected when switching instance
  useEffect(() => {
    setSelected(chats[0] ?? null)
    setSearch("")
  }, [activeInstance])


  useEffect(() => {
    setCaptacion(null)
    if (!selected) return
    const phone = selected.remoteJid.split("@")[0]
    getCaptacionByTelefono(phone).then(setCaptacion).catch(() => setCaptacion(null))
  }, [selected?.remoteJid])

  const filtered = chats.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    const phone = c.remoteJid.split("@")[0]
    return (c.name ?? "").toLowerCase().includes(q) || phone.includes(q)
  })

  return (
    <>
    <div className="flex flex-1 border border-border rounded-xl overflow-hidden min-h-0">
      {/* Sidebar de conversaciones */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card">
        {/* Selector de instancia */}
        {instancias.length > 1 && (
          <div className="p-3 border-b border-border flex gap-1">
            {instancias.map((inst) => (
              <button
                key={inst.id}
                onClick={() => setActiveInstance(inst.id)}
                className={cn(
                  "flex-1 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeInstance === inst.id
                    ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {inst.label}
                <span className="ml-1 opacity-60">
                  ({chatsPorInstancia[inst.id]?.length ?? 0})
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversación..."
              className="w-full pl-8 pr-4 py-2 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border/50 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12">Sin conversaciones</p>
          ) : (
            filtered.map((c) => (
              <ChatItem
                key={c.remoteJid}
                chat={c}
                active={selected?.remoteJid === c.remoteJid}
                onClick={() => setSelected(c)}
              />
            ))
          )}
        </div>
      </div>

      {/* Área principal */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <ChatView
            chat={selected}
            captacion={captacion}
            onVerCaptacion={captacion ? () => setOpenCaptacionId(captacion.id) : undefined}
            instance={activeInstance}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageSquare className="h-10 w-10 opacity-20" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        )}
      </div>
    </div>

    <DetailPanel
      captacionId={openCaptacionId}
      onClose={() => setOpenCaptacionId(null)}
      isAdmin={true}
      hideWhatsApp
    />
  </>
  )
}
