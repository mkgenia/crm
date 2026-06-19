"use client"

import { useState, useTransition } from "react"
import { UserPlus, Pencil, Check, X, Loader2, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  actualizarEstadoLead,
  actualizarNotasLead,
  crearLeadDesdeChat,
} from "@/lib/actions/leads"
import type { EstadoLead } from "@/types/captaciones"

const ESTADOS: EstadoLead[] = ["Nuevo", "Contactado", "Interesado", "Propuesta", "Negociacion", "Ganado", "Perdido"]

const ESTADO_CFG: Record<EstadoLead, { badge: string; label: string }> = {
  Nuevo:       { badge: "bg-violet-500/10 text-violet-500 border-violet-500/20",    label: "Nuevo" },
  Contactado:  { badge: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",          label: "Contactado" },
  Interesado:  { badge: "bg-blue-500/10 text-blue-500 border-blue-500/20",          label: "Interesado" },
  Propuesta:   { badge: "bg-orange-500/10 text-orange-500 border-orange-500/20",    label: "Propuesta" },
  Negociacion: { badge: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",    label: "Negociación" },
  Ganado:      { badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", label: "Ganado" },
  Perdido:     { badge: "bg-muted text-muted-foreground border-border",             label: "Perdido" },
}

interface Lead {
  id: string
  nombre: string
  apellidos: string | null
  telefono: string | null
  email: string | null
  estado: EstadoLead
  notas: string | null
  fuente: string | null
  fecha_creacion: string
  captacion_id: number | null
}

interface Props {
  lead: Lead | null
  chatName: string | null
  phone: string
  onLeadCreated: (lead: Lead) => void
}

export function LeadPanel({ lead: initialLead, chatName, phone, onLeadCreated }: Props) {
  const [lead, setLead] = useState<Lead | null>(initialLead)
  const [editandoNotas, setEditandoNotas] = useState(false)
  const [notas, setNotas] = useState(initialLead?.notas ?? "")
  const [savingNotas, setSavingNotas] = useState(false)
  const [creando, startCreando] = useTransition()
  const [updatingEstado, setUpdatingEstado] = useState(false)

  async function handleCrear() {
    const displayPhone = phone.startsWith("34") ? phone.slice(2) : phone
    startCreando(async () => {
      const res = await crearLeadDesdeChat(chatName ?? "Contacto", displayPhone)
      if (res.error && !res.leadId) return
      const nuevoLead: Lead = {
        id: res.leadId ?? "",
        nombre: chatName ?? "Contacto",
        apellidos: null,
        telefono: displayPhone,
        email: null,
        estado: "Nuevo",
        notas: null,
        fuente: "Mensajes",
        fecha_creacion: new Date().toISOString(),
        captacion_id: null,
      }
      setLead(nuevoLead)
      onLeadCreated(nuevoLead)
    })
  }

  async function handleEstado(estado: EstadoLead) {
    if (!lead) return
    setUpdatingEstado(true)
    await actualizarEstadoLead(lead.id, estado)
    setLead((prev) => prev ? { ...prev, estado } : null)
    setUpdatingEstado(false)
  }

  async function handleGuardarNotas() {
    if (!lead) return
    setSavingNotas(true)
    await actualizarNotasLead(lead.id, notas)
    setLead((prev) => prev ? { ...prev, notas: notas || null } : null)
    setSavingNotas(false)
    setEditandoNotas(false)
  }

  if (!lead) {
    return (
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
        <p className="text-xs text-muted-foreground">Sin lead asociado</p>
        <button
          onClick={handleCrear}
          disabled={creando}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Crear lead
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-b border-border bg-violet-500/5">
      {/* Header del lead */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-violet-500/10">
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {lead.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">
            {lead.nombre}{lead.apellidos ? ` ${lead.apellidos}` : ""}
          </span>
          {lead.fuente && <span className="text-[10px] text-muted-foreground ml-1.5">· {lead.fuente}</span>}
        </div>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0", ESTADO_CFG[lead.estado].badge)}>
          {ESTADO_CFG[lead.estado].label}
        </span>
        <a
          href={`/leads`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Ver en Leads"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Estados */}
      <div className="px-4 py-2 flex gap-1 flex-wrap">
        {ESTADOS.map((e) => (
          <button
            key={e}
            onClick={() => handleEstado(e)}
            disabled={updatingEstado}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded border font-medium transition-all",
              lead.estado === e
                ? ESTADO_CFG[e].badge
                : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
            )}
          >
            {ESTADO_CFG[e].label}
          </button>
        ))}
      </div>

      {/* Notas */}
      <div className="px-4 pb-2">
        {editandoNotas ? (
          <div className="flex items-start gap-1.5">
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Añade notas..."
              className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <div className="flex flex-col gap-1 shrink-0 pt-0.5">
              <button
                onClick={handleGuardarNotas}
                disabled={savingNotas}
                className="p-1 rounded text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
              >
                {savingNotas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => { setEditandoNotas(false); setNotas(lead.notas ?? "") }}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditandoNotas(true); setNotas(lead.notas ?? "") }}
            className="w-full text-left group"
          >
            {lead.notas ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 group-hover:text-foreground transition-colors">
                {lead.notas}
              </p>
            ) : (
              <span className="text-[11px] text-muted-foreground/40 italic flex items-center gap-1 group-hover:text-muted-foreground transition-colors">
                <Pencil className="h-3 w-3" /> Añadir notas...
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
