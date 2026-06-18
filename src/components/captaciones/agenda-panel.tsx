"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { asignarAgenda, actualizarEstadoAgenda } from "@/lib/actions/captaciones"
import { toast } from "sonner"
import { Check, X, CalendarClock, FileText, Bell, Loader2, ArrowLeftRight, ChevronDown } from "lucide-react"
import { AGENDA_COLORS, type EstadoAgenda } from "@/types/captaciones"
import { cn } from "@/lib/utils"

interface Agente {
  id: string
  nombre: string
  apellidos: string | null
  avatar_url: string | null
}

interface Props {
  captacionId: number
  agentes: Agente[]
  initial: {
    agente_id: string | null
    fecha_agenda: string | null
    recordatorio_fecha: string | null
    notas_agenda: string | null
    estado_agenda: EstadoAgenda
  }
  onUpdate?: () => void
}

function toDatetimeLocal(iso: string | null) {
  if (!iso) return ""
  return iso.slice(0, 16)
}

function initials(a: Agente) {
  return `${a.nombre.charAt(0)}${a.apellidos?.charAt(0) ?? ""}`.toUpperCase()
}

export function AgendaPanel({ captacionId, agentes, initial, onUpdate }: Props) {
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState<EstadoAgenda | null>(null)
  const [traspasando, setTraspasando] = useState(false)
  const [form, setForm] = useState({
    agente_id: initial.agente_id ?? "",
    fecha_agenda: toDatetimeLocal(initial.fecha_agenda),
    recordatorio_fecha: toDatetimeLocal(initial.recordatorio_fecha),
    notas_agenda: initial.notas_agenda ?? "",
    estado_agenda: initial.estado_agenda,
  })

  const hasAgenda = !!initial.agente_id
  const estadoInfo = AGENDA_COLORS[form.estado_agenda]
  const agenteActual = agentes.find((a) => a.id === form.agente_id)

  async function handleGuardar() {
    setLoading(true)
    const res = await asignarAgenda(captacionId, {
      agente_id: form.agente_id || null,
      fecha_agenda: form.fecha_agenda ? new Date(form.fecha_agenda).toISOString() : null,
      recordatorio_fecha: form.recordatorio_fecha ? new Date(form.recordatorio_fecha).toISOString() : null,
      notas_agenda: form.notas_agenda || null,
      estado_agenda: form.estado_agenda,
    })
    setLoading(false)
    if (res.error) { toast.error("Error al guardar"); return }
    toast.success(hasAgenda ? "Agenda actualizada" : "Agente asignado")
    setTraspasando(false)
    onUpdate?.()
  }

  async function handleStatus(estado: EstadoAgenda) {
    setStatusLoading(estado)
    const res = await actualizarEstadoAgenda(captacionId, estado)
    setStatusLoading(null)
    if (res.error) { toast.error("Error al actualizar"); return }
    setForm((f) => ({ ...f, estado_agenda: estado }))
    toast.success(`Marcada como ${estado}`)
    onUpdate?.()
  }

  return (
    <div className="space-y-5">

      {/* Estado actual + acciones rápidas */}
      {hasAgenda && (
        <div className={cn("flex items-center justify-between rounded-lg px-4 py-3 border", estadoInfo.bg, "border-border")}>
          <div className="flex items-center gap-2.5">
            <span className={cn("h-2 w-2 rounded-full", estadoInfo.dot)} />
            <span className={cn("text-sm font-medium capitalize", estadoInfo.text)}>
              {form.estado_agenda}
            </span>
            {agenteActual && (
              <span className="text-xs text-muted-foreground">· {agenteActual.nombre}</span>
            )}
          </div>
          {form.estado_agenda === "pendiente" && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost"
                className="h-7 px-2 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                onClick={() => handleStatus("completado")} disabled={!!statusLoading}
              >
                {statusLoading === "completado" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Completar
              </Button>
              <Button size="sm" variant="ghost"
                className="h-7 px-2 text-red-500 hover:text-red-500 hover:bg-red-500/10"
                onClick={() => handleStatus("cancelado")} disabled={!!statusLoading}
              >
                {statusLoading === "cancelado" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Agente asignado */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
          Agente asignado
        </Label>

        {hasAgenda && !traspasando ? (
          /* Agente actual + botón traspasar */
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white shrink-0">
              {agenteActual ? initials(agenteActual) : "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {agenteActual ? `${agenteActual.nombre} ${agenteActual.apellidos ?? ""}`.trim() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Agente asignado</p>
            </div>
            <Button
              size="sm" variant="ghost"
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setTraspasando(true)}
            >
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />
              Traspasar
            </Button>
          </div>
        ) : (
          /* Grid de selección de agente */
          <div className="space-y-2">
            {hasAgenda && (
              <button
                onClick={() => { setForm((f) => ({ ...f, agente_id: initial.agente_id ?? "" })); setTraspasando(false) }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" /> Cancelar traspaso
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {agentes.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setForm((f) => ({ ...f, agente_id: f.agente_id === a.id ? "" : a.id }))}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                    form.agente_id === a.id
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                    form.agente_id === a.id
                      ? "bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {initials(a)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{a.nombre}</p>
                    {a.apellidos && <p className="text-xs text-muted-foreground truncate">{a.apellidos}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fecha y hora */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
          <CalendarClock className="h-3.5 w-3.5" /> Fecha y hora
        </Label>
        <input
          type="datetime-local"
          value={form.fecha_agenda}
          onChange={(e) => setForm((f) => ({ ...f, fecha_agenda: e.target.value }))}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Recordatorio */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
          <Bell className="h-3.5 w-3.5" /> Recordatorio (opcional)
        </Label>
        <input
          type="datetime-local"
          value={form.recordatorio_fecha}
          onChange={(e) => setForm((f) => ({ ...f, recordatorio_fecha: e.target.value }))}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Notas */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
          <FileText className="h-3.5 w-3.5" /> Notas para el agente
        </Label>
        <textarea
          rows={3}
          value={form.notas_agenda}
          onChange={(e) => setForm((f) => ({ ...f, notas_agenda: e.target.value }))}
          placeholder="Indicaciones, contexto, objetivos..."
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>

      <Button
        onClick={handleGuardar}
        disabled={loading || !form.agente_id}
        className="w-full"
      >
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {hasAgenda ? (traspasando ? "Confirmar traspaso" : "Guardar cambios") : "Asignar agente"}
      </Button>
    </div>
  )
}
