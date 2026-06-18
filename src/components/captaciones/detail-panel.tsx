"use client"

import { useState, useEffect, useRef } from "react"
import { X, MapPin, Home, TrendingDown, TrendingUp, ExternalLink, CalendarClock, Info, Loader2, Check, Trash2, MessageCircle, PhoneOff, Sparkles, Send, Phone } from "lucide-react"
import { AgendaPanel } from "./agenda-panel"
import { getCaptacion, getHistorial, getAgentes, actualizarEstadoCaptacion, actualizarEstadoAgenda, eliminarCaptacion, contactarCaptacion, generarMensajeIA, marcarRespondido } from "@/lib/actions/captaciones"
import { getMensajesCaptacion, type Mensaje } from "@/lib/actions/mensajes"
import { Skeleton } from "@/components/ui/skeleton"
import { ESTADO_COLORS, ESTADO_LABELS, AGENDA_COLORS, ESTADOS_CAPTACION, WA_CLASIFICACIONES, type EstadoAgenda } from "@/types/captaciones"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

type Tab = "agenda" | "info"

const ESTADOS_OCULTOS = ["sin identificar", "no especificado", "sin especificar", "desconocido"]

function AgendaAgente({ captacionId, estado_crm, agente, fecha_agenda, notas_agenda, estado_agenda, onUpdate }: {
  captacionId: number
  estado_crm: string | null
  agente: any
  fecha_agenda: string | null
  notas_agenda: string | null
  estado_agenda: EstadoAgenda
  onUpdate: () => void
}) {
  const [estadoActual, setEstadoActual] = useState(estado_crm ?? "")
  const [savingEstado, setSavingEstado] = useState(false)
  const [statusLoading, setStatusLoading] = useState<EstadoAgenda | null>(null)
  const colors = AGENDA_COLORS[estado_agenda] ?? AGENDA_COLORS.pendiente

  async function handleEstadoCaptacion(nuevoEstado: string) {
    setSavingEstado(true)
    const prev = estadoActual
    setEstadoActual(nuevoEstado)
    const res = await actualizarEstadoCaptacion(captacionId, nuevoEstado)
    setSavingEstado(false)
    if (res.error) { toast.error(res.error); setEstadoActual(prev) }
    else { toast.success(`Estado CRM: ${nuevoEstado}`); onUpdate() }
  }

  async function handleStatus(nuevo: EstadoAgenda) {
    setStatusLoading(nuevo)
    const res = await actualizarEstadoAgenda(captacionId, nuevo)
    setStatusLoading(null)
    if (res.error) { toast.error("Error al actualizar"); return }
    toast.success(`Visita marcada como ${nuevo}`)
    onUpdate()
  }

  const estadoMostrado = estadoActual && !ESTADOS_OCULTOS.includes(estadoActual.toLowerCase().trim()) ? estadoActual : null

  return (
    <div className="space-y-5">
      {/* Estado de agenda + completar/cancelar */}
      <div className={cn("flex items-center justify-between rounded-lg px-4 py-3 border", colors.bg, "border-border")}>
        <div className="flex items-center gap-2.5">
          <span className={cn("h-2 w-2 rounded-full", colors.dot)} />
          <span className={cn("text-sm font-medium capitalize", colors.text)}>{estado_agenda}</span>
        </div>
        {estado_agenda === "pendiente" && (
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

      {/* Selector de estado de captación */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          Estado de la captación
          {savingEstado && <Loader2 className="h-3 w-3 animate-spin" />}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {ESTADOS_CAPTACION.map((e) => {
            const style = ESTADO_COLORS[e] ?? { bg: "bg-muted", text: "text-muted-foreground" }
            const active = estadoMostrado === e
            return (
              <button
                key={e}
                onClick={() => handleEstadoCaptacion(e)}
                disabled={savingEstado}
                className={cn(
                  "px-2 py-1.5 rounded-md text-xs font-medium border transition-all",
                  active
                    ? cn(style.bg, style.text, "border-current/30 ring-1 ring-current/20")
                    : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {ESTADO_LABELS[e] ?? e}
              </button>
            )
          })}
        </div>
      </div>

      {/* Info agenda */}
      {fecha_agenda && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-2.5">
          <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Fecha programada</p>
            <p className="text-sm font-medium text-foreground">
              {new Date(fecha_agenda).toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" })}
              {" · "}
              {new Date(fecha_agenda).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      )}
      {notas_agenda && (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">Notas</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{notas_agenda}</p>
        </div>
      )}
      {!fecha_agenda && !notas_agenda && (
        <p className="text-sm text-muted-foreground text-center py-4">Sin fecha programada</p>
      )}
    </div>
  )
}

function hasPhone(tel: string | null) {
  if (!tel) return false
  const l = tel.toLowerCase()
  return !l.includes("no disponible") && !l.includes("privado") && tel.trim() !== ""
}

function fmtHora(ts: number) {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
}

function fmtDia(ts: number) {
  const d = new Date(ts * 1000)
  const hoy = new Date()
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1)
  if (d.toDateString() === hoy.toDateString()) return "Hoy"
  if (d.toDateString() === ayer.toDateString()) return "Ayer"
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" })
}

function WhatsAppPanel({ captacion, onUpdate }: { captacion: any; onUpdate: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [generando, setGenerando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const tienePhone = hasPhone(captacion.telefono)
  const estadoWA = captacion.estado_whatsapp as string | null

  async function cargarMensajes() {
    if (!tienePhone) return
    setCargando(true)
    const data = await getMensajesCaptacion(captacion.telefono)
    setMensajes(data)
    setCargando(false)
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 50)
  }

  // Siempre intentar cargar mensajes si hay teléfono — puede haber conversación del dashboard anterior
  useEffect(() => { if (tienePhone) cargarMensajes() }, [captacion.id])

  async function handleGenerar() {
    setGenerando(true)
    const msg = await generarMensajeIA(captacion.id)
    setMensaje(msg)
    setExpandido(true)
    setGenerando(false)
  }

  async function handleEnviar() {
    if (!mensaje.trim()) return
    setEnviando(true)
    const res = await contactarCaptacion(captacion.id, mensaje)
    setEnviando(false)
    if (res.error) { toast.error(res.error); return }
    toast.success("Mensaje enviado por WhatsApp")
    onUpdate()
    cargarMensajes()
  }

  const clasificacion = estadoWA ? WA_CLASIFICACIONES[estadoWA] : null

  // Agrupar mensajes por día
  const porDia: { dia: string; items: Mensaje[] }[] = []
  for (const m of mensajes) {
    const dia = fmtDia(m.timestamp)
    const last = porDia[porDia.length - 1]
    if (last?.dia === dia) last.items.push(m)
    else porDia.push({ dia, items: [m] })
  }

  return (
    <div className="mb-5 rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
        <MessageCircle className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex-1">WhatsApp</span>
        {!tienePhone && (
          <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
            <PhoneOff className="h-3 w-3" /> Sin teléfono
          </span>
        )}
        {tienePhone && !estadoWA && (
          <span className="text-xs text-muted-foreground">{captacion.telefono}</span>
        )}
        {clasificacion && (
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", clasificacion.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", clasificacion.dot)} />
            {estadoWA === "Enviado" ? "Enviado · sin respuesta" : clasificacion.label}
          </span>
        )}
        {tienePhone && (
          <button
            onClick={cargarMensajes}
            disabled={cargando}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Actualizar"
          >
            {cargando
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3 w-3 rotate-180" />}
          </button>
        )}
      </div>

      {tienePhone && (
        <div className="space-y-0">

          {/* Conversación — se muestra si hay mensajes cargados o está cargando */}
          {(cargando || mensajes.length > 0) && (
            <div ref={chatRef} className="max-h-72 overflow-y-auto px-4 py-3 space-y-1 bg-muted/10">
              {cargando && mensajes.length === 0 && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!cargando && mensajes.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-4">Sin mensajes cargados</p>
              )}
              {porDia.map(({ dia, items }) => (
                <div key={dia} className="space-y-1">
                  {/* Separador de día */}
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-muted-foreground">{dia}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {items.map((m) => (
                    <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[78%] rounded-xl px-3 py-2 text-xs",
                        m.fromMe
                          ? "bg-violet-600 text-white rounded-br-sm"
                          : "bg-card border border-border text-foreground rounded-bl-sm"
                      )}>
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={cn("text-[10px] mt-1 text-right", m.fromMe ? "text-violet-200" : "text-muted-foreground")}>
                          {fmtHora(m.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Sin mensajes: generar y enviar primer mensaje */}
          {!cargando && mensajes.length === 0 && (
            <div className="p-4 space-y-3">
              {!expandido ? (
                <button
                  onClick={handleGenerar}
                  disabled={generando}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-md border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-violet-500/50 transition-colors"
                >
                  {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generando ? "Generando mensaje..." : "Generar mensaje con IA"}
                </button>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={6}
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setExpandido(false)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border">
                      Cancelar
                    </button>
                    <button onClick={handleGenerar} disabled={generando} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border">
                      <Sparkles className="h-3 w-3" /> Regenerar
                    </button>
                    <button
                      onClick={handleEnviar}
                      disabled={enviando || !mensaje.trim()}
                      className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium disabled:opacity-40 transition-colors"
                    >
                      {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Enviar por WhatsApp
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  captacionId: number | null
  onClose: () => void
  isAdmin?: boolean
  hideWhatsApp?: boolean
}

function fmt(n: number | null) {
  if (!n) return "—"
  return n.toLocaleString("es-ES") + " €"
}

export function DetailPanel({ captacionId, onClose, isAdmin = true, hideWhatsApp = false }: Props) {
  const [tab, setTab] = useState<Tab>("agenda")
  const [data, setData] = useState<Awaited<ReturnType<typeof getCaptacion>> | null>(null)
  const [historial, setHistorial] = useState<Awaited<ReturnType<typeof getHistorial>>>([])
  const [agentes, setAgentes] = useState<Awaited<ReturnType<typeof getAgentes>>>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!captacionId) return
    setLoading(true)
    try {
      const [cap, hist, ags] = await Promise.all([
        getCaptacion(captacionId),
        getHistorial(captacionId),
        getAgentes(),
      ])
      setData(cap)
      setHistorial(hist)
      setAgentes(ags)
    } catch (e) {
      toast.error("Error al cargar la captación")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (captacionId) { setTab("agenda"); load() }
  }, [captacionId])

  const open = !!captacionId

  return (
    <>
      {/* Overlay */}
      <div
        className={cn("fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300", open ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={onClose}
      />

      {/* Panel */}
      <div className={cn(
        "fixed right-0 top-0 h-full w-full max-w-md z-50 bg-background border-l border-border flex flex-col shadow-2xl transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full"
      )}>

        {loading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : data ? (
          <>
            {/* Imagen + header */}
            <div className="relative shrink-0">
              {data.imagenes?.[0] || data.imagen_url ? (
                <img
                  src={data.imagenes?.[0] ?? data.imagen_url!}
                  alt={data.calle ?? ""}
                  className="w-full h-44 object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                />
              ) : (
                <div className="w-full h-44 bg-muted flex items-center justify-center">
                  <Home className="h-10 w-10 text-muted-foreground/30" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Botones header */}
              <div className="absolute top-3 right-3 flex items-center gap-2">
                {isAdmin && (
                  <button
                    onClick={async () => {
                      if (!confirm("¿Dar de baja esta captación? Dejará de aparecer en el listado.")) return
                      const res = await eliminarCaptacion(data!.id)
                      if (res.error) { toast.error(res.error); return }
                      toast.success("Captación dada de baja")
                      onClose()
                    }}
                    className="h-8 w-8 rounded-full bg-black/50 flex items-center justify-center text-red-400 hover:bg-red-500/80 hover:text-white transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="h-8 w-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Info sobre imagen */}
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <p className="text-white font-semibold text-base leading-tight truncate">
                  {data.calle ?? "Sin dirección"}
                </p>
                {data.barrio && (
                  <span className="text-white/70 text-xs flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3 w-3" /> {data.barrio}
                  </span>
                )}
                {/* Los 3 estados — fila separada, etiquetados */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {/* Estado inmueble (Idealista, read-only) */}
                  {data.estado && !["sin identificar","no especificado","sin especificar","desconocido"].includes(data.estado.toLowerCase().trim()) && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/60 border border-white/10">
                      <Home className="h-2.5 w-2.5" /> {data.estado}
                    </span>
                  )}
                  {/* Estado CRM (gestión del agente) */}
                  {(data as any).estado_crm && (() => {
                    const s = ESTADO_COLORS[(data as any).estado_crm]
                    return (
                      <span className={cn("flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold border border-current/20", s?.bg ?? "bg-cyan-500/20", s?.text ?? "text-cyan-400")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {(data as any).estado_crm}
                      </span>
                    )
                  })()}
                  {/* Estado WhatsApp (automático) */}
                  {(data as any).estado_whatsapp && (() => {
                    const waColors: Record<string, string> = {
                      Pendiente:     "bg-zinc-500/30 text-zinc-300 border-zinc-400/20",
                      Enviado:       "bg-violet-500/30 text-violet-300 border-violet-400/20",
                      Respondido:    "bg-cyan-500/30 text-cyan-300 border-cyan-400/20",
                      Interesado:    "bg-emerald-500/30 text-emerald-300 border-emerald-400/20",
                      Callback:      "bg-orange-500/30 text-orange-300 border-orange-400/20",
                      No_Interesado: "bg-red-500/30 text-red-300 border-red-400/20",
                    }
                    const waLabels: Record<string, string> = {
                      Pendiente: "WA Pendiente", Enviado: "WA Enviado", Respondido: "WA Respondido",
                      Interesado: "WA Interesado", Callback: "WA Llamada", No_Interesado: "WA No interesa",
                    }
                    const key = (data as any).estado_whatsapp
                    return (
                      <span className={cn("flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold border", waColors[key] ?? "bg-white/10 text-white/60 border-white/10")}>
                        <MessageCircle className="h-2.5 w-2.5" /> {waLabels[key] ?? key}
                      </span>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Stats rápidos */}
            <div className="grid grid-cols-4 gap-px bg-border shrink-0">
              {[
                { label: "Precio", value: fmt(data.precio) },
                { label: "€/m²", value: data.precio_m2 ? data.precio_m2.toLocaleString("es-ES") : "—" },
                { label: "Metros", value: data.metros ? `${data.metros}m²` : "—" },
                { label: "Hab.", value: data.habitaciones ?? "—" },
              ].map((s) => (
                <div key={s.label} className="bg-card px-3 py-2.5 text-center">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-semibold text-foreground">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              <button
                onClick={() => setTab("agenda")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                  tab === "agenda"
                    ? "border-violet-500 text-violet-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <CalendarClock className="h-4 w-4" />
                Agenda
                {data.agente_id && (
                  <span className={cn("h-1.5 w-1.5 rounded-full ml-0.5", AGENDA_COLORS[data.estado_agenda as EstadoAgenda]?.dot ?? "bg-violet-500")} />
                )}
              </button>
              <button
                onClick={() => setTab("info")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                  tab === "info"
                    ? "border-violet-500 text-violet-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Info className="h-4 w-4" />
                Información
              </button>
            </div>

            {/* Contenido scrollable */}
            <div className="flex-1 overflow-y-auto p-5">

              {tab === "agenda" && isAdmin && !hideWhatsApp && (
                <WhatsAppPanel captacion={data} onUpdate={load} />
              )}

              {tab === "agenda" && (
                isAdmin ? (
                  <AgendaPanel
                    captacionId={data.id}
                    agentes={agentes}
                    initial={{
                      agente_id: data.agente_id,
                      fecha_agenda: data.fecha_agenda,
                      recordatorio_fecha: data.recordatorio_fecha,
                      notas_agenda: data.notas_agenda,
                      estado_agenda: (data.estado_agenda as EstadoAgenda) ?? "pendiente",
                    }}
                    onUpdate={load}
                  />
                ) : (
                  <AgendaAgente
                    captacionId={data.id}
                    estado_crm={(data as any).estado_crm ?? null}
                    agente={Array.isArray(data.agente) ? data.agente[0] : data.agente}
                    fecha_agenda={data.fecha_agenda}
                    notas_agenda={data.notas_agenda}
                    estado_agenda={(data.estado_agenda as EstadoAgenda) ?? "pendiente"}
                    onUpdate={load}
                  />
                )
              )}

              {tab === "info" && (
                <div className="space-y-5">

                  {/* Propietario */}
                  {(data.nombre || data.telefono) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Propietario</p>
                      <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                        {data.nombre && <p className="text-sm font-medium text-foreground">{data.nombre}</p>}
                        {data.telefono && (
                          <p className="text-sm text-muted-foreground">{data.telefono}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Detalles */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Detalles</p>
                    <div className="rounded-lg border border-border bg-card divide-y divide-border">
                      {[
                        { label: "Planta", value: data.planta },
                        { label: "Baños", value: data.banos },
                        { label: "Ascensor", value: data.tiene_ascensor === true ? "Sí" : data.tiene_ascensor === false ? "No" : null },
                      ].filter((r) => r.value != null).map((r) => (
                        <div key={r.label} className="flex justify-between px-4 py-2.5 text-sm">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="font-medium text-foreground">{String(r.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Historial de cambios */}
                  {historial.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Historial</p>
                      <div className="relative pl-4">
                        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                        <div className="space-y-3">
                          {historial.map((h) => {
                            const isPrecio = h.campo === "precio"
                            const isEstado = h.campo === "estado"
                            const fecha = new Date(h.fecha).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" })
                            const hora = new Date(h.fecha).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })

                            let content: React.ReactNode
                            if (isPrecio) {
                              const prev = Number(h.valor_anterior)
                              const next = Number(h.valor_nuevo)
                              const diff = next - prev
                              content = (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium text-foreground">{fmt(next)}</span>
                                  {diff !== 0 && (
                                    <span className={cn("flex items-center gap-0.5 text-xs", diff < 0 ? "text-emerald-500" : "text-red-500")}>
                                      {diff < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                                      {Math.abs(diff).toLocaleString("es-ES")}€
                                    </span>
                                  )}
                                  {h.valor_anterior && <span className="text-xs text-muted-foreground line-through">{fmt(prev)}</span>}
                                </div>
                              )
                            } else if (isEstado) {
                              const estilo = ESTADO_COLORS[h.valor_nuevo ?? ""] ?? { bg: "bg-muted", text: "text-muted-foreground" }
                              content = (
                                <div className="flex items-center gap-1.5">
                                  {h.valor_anterior && (
                                    <span className="text-xs text-muted-foreground">{h.valor_anterior}</span>
                                  )}
                                  {h.valor_anterior && <span className="text-xs text-muted-foreground">→</span>}
                                  <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", estilo.bg, estilo.text)}>
                                    {h.valor_nuevo}
                                  </span>
                                </div>
                              )
                            } else {
                              content = (
                                <span className="text-xs text-foreground">
                                  {h.campo}: {h.valor_anterior ?? "—"} → {h.valor_nuevo ?? "—"}
                                </span>
                              )
                            }

                            return (
                              <div key={h.id} className="flex gap-3 items-start">
                                <div className={cn(
                                  "h-3.5 w-3.5 rounded-full border-2 border-background shrink-0 mt-0.5 -ml-1.5",
                                  isPrecio ? "bg-violet-500" : isEstado ? "bg-cyan-500" : "bg-muted-foreground"
                                )} />
                                <div className="flex-1 min-w-0 pb-1">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-[10px] text-muted-foreground">{fecha} · {hora}</span>
                                    <span className="text-[10px] text-muted-foreground/60 capitalize">{h.campo}</span>
                                  </div>
                                  {content}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Link externo */}
                  {data.url && (
                    <a
                      href={data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver en Idealista
                    </a>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
