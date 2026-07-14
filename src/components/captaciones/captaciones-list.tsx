"use client"

import { useEffect, useMemo, useState } from "react"
import { DetailPanel } from "./detail-panel"
import { PapeleraList } from "./papelera-list"
import { MapPin, Home, CalendarClock, Search, LayoutGrid, List, KanbanSquare, PhoneOff, MessageCircle, Trash2, Loader2, CheckSquare, Square, Trash, ChevronLeft, ChevronRight } from "lucide-react"
import { CaptacionesPipeline } from "./captaciones-pipeline"
import { ESTADO_COLORS, AGENDA_COLORS, WA_CLASIFICACIONES, type EstadoAgenda } from "@/types/captaciones"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { darDeBajaMasivo, asignarAgentesMasivo } from "@/lib/actions/captaciones"
import type { getCaptaciones } from "@/lib/actions/captaciones"

type Captacion = Awaited<ReturnType<typeof getCaptaciones>>[number]
type AgenteInfo = { id: string; nombre: string; apellidos: string | null; avatar_url: string | null }

// Captaciones renderizadas por página en vistas grid/lista (evita volcar cientos de nodos)
const PAGE_SIZE = 48

const FILTROS = [
  { key: "todas",       label: "Todas" },
  { key: "sin_agente",  label: "Sin asignar" },
  { key: "agendadas",   label: "Agendadas" },
  { key: "pendientes",  label: "Pendientes" },
  { key: "completadas", label: "Completadas" },
]

function fmt(n: number | null) {
  if (!n) return "—"
  return `${n.toLocaleString("es-ES")} €`
}

function fmtFecha(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return (
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) +
    " " +
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  )
}

function AgenteBadge({ agente, estado_agenda }: { agente: AgenteInfo | AgenteInfo[] | null; estado_agenda: string }) {
  const a = Array.isArray(agente) ? agente[0] : agente
  if (!a) return null
  const colors = AGENDA_COLORS[estado_agenda as EstadoAgenda] ?? AGENDA_COLORS.pendiente
  const init = `${String(a.nombre).charAt(0)}${a.apellidos ? String(a.apellidos).charAt(0) : ""}`.toUpperCase()
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border border-border", colors.bg)}>
      <span className="h-4 w-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400">
        {init}
      </span>
      <span className={colors.text}>{String(a.nombre)}</span>
    </div>
  )
}

const ESTADOS_OCULTOS = ["sin identificar", "no especificado", "sin especificar", "desconocido", ""]

function hasPhone(tel: string | null) {
  if (!tel) return false
  const l = tel.toLowerCase()
  return !l.includes("no disponible") && !l.includes("privado") && tel.trim() !== ""
}

function estadoVisible(estado: string | null): string | null {
  if (!estado) return null
  if (ESTADOS_OCULTOS.includes(estado.toLowerCase().trim())) return null
  return estado
}

function CaptacionCard({ cap, onClick, selected, onSelect }: { cap: Captacion; onClick: () => void; selected?: boolean; onSelect?: (e: React.MouseEvent) => void }) {
  const estado = estadoVisible(cap.estado)
  const estadoStyle = estado ? (ESTADO_COLORS[estado] ?? { bg: "bg-muted", text: "text-muted-foreground" }) : null

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-xl border bg-card overflow-hidden hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-200",
        selected ? "border-violet-500/50 ring-1 ring-violet-500/20" : "border-border"
      )}
    >
      {/* Checkbox selección */}
      <div
        onClick={onSelect}
        className={cn(
          "absolute top-2 left-2 z-10 h-5 w-5 rounded flex items-center justify-center transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        {selected
          ? <CheckSquare className="h-4 w-4 text-violet-500 drop-shadow" />
          : <Square className="h-4 w-4 text-white drop-shadow" />
        }
      </div>
      <div className="relative h-36 overflow-hidden bg-muted">
        {cap.imagenes?.[0] || cap.imagen_url ? (
          <img
            src={cap.imagenes?.[0] ?? cap.imagen_url!}
            alt={cap.calle ?? ""}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Home className="h-8 w-8 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm rounded-md px-2 py-1">
          <span className="text-white text-sm font-semibold">{fmt(cap.precio)}</span>
        </div>
        {/* Sin teléfono */}
        {!hasPhone(cap.telefono) && (
          <div className="absolute top-2 left-2">
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/90 text-white">
              <PhoneOff className="h-2.5 w-2.5" /> Sin tel.
            </span>
          </div>
        )}
        {estadoStyle && estado && (
          <div className={cn("absolute top-2 right-2 text-xs px-2 py-0.5 rounded font-medium", estadoStyle.bg, estadoStyle.text)}>
            {estado}
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <p className="text-sm font-medium text-foreground leading-tight truncate">
          {cap.calle ?? "Sin dirección"}
        </p>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {cap.barrio && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" /> {cap.barrio}
            </span>
          )}
          <span className="ml-auto shrink-0">
            {[cap.metros && `${cap.metros}m²`, cap.habitaciones && `${cap.habitaciones}h`].filter(Boolean).join(" · ")}
          </span>
        </div>

        {/* Indicador de contacto WA */}
        {(() => {
          const wa = cap.estado_whatsapp
          if (!wa) return null
          const cfg: Record<string, { dot: string; label: string; text: string }> = {
            Pendiente:     { dot: "bg-zinc-400",    label: "Pendiente",       text: "text-zinc-400" },
            Enviado:       { dot: "bg-violet-500",  label: "WA enviado",      text: "text-violet-400" },
            Respondido:    { dot: "bg-cyan-500",    label: "Ha respondido",   text: "text-cyan-400" },
            Interesado:    { dot: "bg-emerald-500", label: "Interesado",      text: "text-emerald-400" },
            Quiere_Llamada: { dot: "bg-orange-500",  label: "Quiere llamada",  text: "text-orange-400" },
            No_Interesado: { dot: "bg-red-500",     label: "No interesado",   text: "text-red-400" },
          }
          const c = cfg[wa]
          if (!c) return null
          return (
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 animate-[pulse_2s_ease-in-out_infinite]", c.dot)} />
              <span className={cn("text-[11px] font-medium", c.text)}>{c.label}</span>
            </div>
          )
        })()}

        {cap.agente && (
          <div className="flex items-center justify-between">
            <AgenteBadge agente={cap.agente as AgenteInfo | AgenteInfo[]} estado_agenda={cap.estado_agenda} />
            {cap.fecha_agenda && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                {fmtFecha(cap.fecha_agenda)}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

function WaBadgeInline({ estado }: { estado: string | null }) {
  if (!estado) return null
  const cls = WA_CLASIFICACIONES[estado]
  if (!cls) return null
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full", cls.bg, cls.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cls.dot)} />
      {cls.label}
    </span>
  )
}

function CaptacionRow({ cap, onClick, selected, onSelect }: { cap: Captacion; onClick: () => void; selected?: boolean; onSelect?: () => void }) {
  const estadoCrm = cap.estado_crm
  const estadoCrmStyle = estadoCrm ? (ESTADO_COLORS[estadoCrm] ?? { bg: "bg-muted", text: "text-muted-foreground" }) : null
  const sinTel = !hasPhone(cap.telefono)

  return (
    <button
      onClick={onClick}
      className={cn(
        "group w-full grid items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors text-left border-b border-border/60 last:border-0",
        selected && "bg-violet-500/5"
      )}
      style={{ gridTemplateColumns: "1.5rem 3.5rem 1fr 7rem 7rem 8rem 7rem" }}
    >
      {/* Checkbox */}
      <div onClick={(e) => { e.stopPropagation(); onSelect?.() }} className="flex items-center justify-center">
        {selected
          ? <CheckSquare className="h-4 w-4 text-violet-500" />
          : <Square className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        }
      </div>

      {/* Imagen */}
      <div className="h-11 w-14 rounded-lg overflow-hidden bg-muted shrink-0">
        {cap.imagenes?.[0] || cap.imagen_url ? (
          <img
            src={cap.imagenes?.[0] ?? cap.imagen_url!}
            alt=""
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Home className="h-4 w-4 text-muted-foreground/20" />
          </div>
        )}
      </div>

      {/* Dirección + barrio */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-violet-400 transition-colors">
          {cap.calle ?? "Sin dirección"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {[cap.barrio, cap.metros && `${cap.metros} m²`, cap.habitaciones && `${cap.habitaciones} hab.`].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* Precio */}
      <div className="text-right">
        <p className="text-sm font-semibold text-foreground">{fmt(cap.precio)}</p>
        {cap.precio_m2 && (
          <p className="text-[11px] text-muted-foreground">{Math.round(cap.precio_m2).toLocaleString("es-ES")} €/m²</p>
        )}
      </div>

      {/* WhatsApp */}
      <div className="flex justify-center">
        {sinTel ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
            <PhoneOff className="h-3 w-3" /> Sin tel.
          </span>
        ) : (
          <WaBadgeInline estado={cap.estado_whatsapp} />
        )}
      </div>

      {/* Estado CRM */}
      <div className="flex justify-center">
        {estadoCrmStyle && estadoCrm ? (
          <span className={cn("text-[10px] font-semibold px-2.5 py-0.5 rounded-full", estadoCrmStyle.bg, estadoCrmStyle.text)}>
            {estadoCrm}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Agente */}
      <div className="flex justify-end">
        {cap.agente ? (
          <AgenteBadge agente={cap.agente as AgenteInfo | AgenteInfo[]} estado_agenda={cap.estado_agenda} />
        ) : (
          <span className="text-[10px] text-muted-foreground/40">Sin asignar</span>
        )}
      </div>
    </button>
  )
}

function ListHeader() {
  return (
    <div
      className="grid items-center gap-4 px-5 py-2.5 border-b border-border bg-muted/30 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
      style={{ gridTemplateColumns: "1.5rem 3.5rem 1fr 7rem 7rem 8rem 7rem" }}
    >
      <div />
      <div />
      <div>Propiedad</div>
      <div className="text-right">Precio</div>
      <div className="text-center">WhatsApp</div>
      <div className="text-center">Estado CRM</div>
      <div className="text-right">Agente</div>
    </div>
  )
}

interface Props {
  initialData: Captacion[]
  eliminadas?: Captacion[]
  total: number
  totalSinAgente: number
  totalAgendadas: number
  isAdmin?: boolean
  agentes?: AgenteInfo[]
}

export function CaptacionesList({ initialData, eliminadas = [], total, totalSinAgente, totalAgendadas, isAdmin = true, agentes = [] }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [filtro, setFiltro] = useState("todas")
  const [vista, setVista] = useState<"grid" | "list" | "pipeline">("grid")
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<"activas" | "papelera">("activas" as "activas" | "papelera")
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set())
  const [bajaLoading, setBajaLoading] = useState(false)
  const [asignarLoading, setAsignarLoading] = useState(false)
  const [showAsignarMenu, setShowAsignarMenu] = useState(false)
  const [confirmBaja, setConfirmBaja] = useState(false)
  const [pendingAgente, setPendingAgente] = useState<AgenteInfo | null>(null)

  const filtered = initialData
    .filter((c) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        (c.calle ?? "").toLowerCase().includes(q) ||
        (c.barrio ?? "").toLowerCase().includes(q) ||
        (c.nombre ?? "").toLowerCase().includes(q)
      )
    })
    .filter((c) => {
      if (filtro === "sin_agente")  return !c.agente_id
      if (filtro === "agendadas")   return !!c.agente_id
      if (filtro === "pendientes")  return !!c.agente_id && c.estado_agenda === "pendiente"
      if (filtro === "completadas") return c.estado_agenda === "completado"
      return true
    })

  // Reset a la primera página cuando cambian los filtros o la búsqueda
  useEffect(() => { setPage(1) }, [search, filtro])

  // Solo paginamos grid/lista; el pipeline gestiona su propia paginación por columna
  const paginado = vista === "pipeline"
  const totalPages = paginado ? 1 : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const visibles = useMemo(
    () => (paginado ? filtered : filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)),
    [filtered, paginado, pageSafe]
  )

  const counts: Record<string, number> = {
    todas:       total,
    sin_agente:  totalSinAgente,
    agendadas:   totalAgendadas,
    pendientes:  initialData.filter((c) => c.agente_id && c.estado_agenda === "pendiente").length,
    completadas: initialData.filter((c) => c.estado_agenda === "completado").length,
  }

  const todosSeleccionados = filtered.length > 0 && filtered.every((c) => seleccionados.has(c.id))

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleTodos() {
    if (todosSeleccionados) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(filtered.map((c) => c.id)))
    }
  }

  async function handleDarDeBajaMasivo() {
    if (!seleccionados.size) return
    setConfirmBaja(false)
    setBajaLoading(true)
    const res = await darDeBajaMasivo(Array.from(seleccionados))
    setBajaLoading(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${seleccionados.size} captaciones dadas de baja`)
    setSeleccionados(new Set())
  }

  async function handleAsignarAgente(agente: AgenteInfo) {
    if (!seleccionados.size) return
    setShowAsignarMenu(false)
    setPendingAgente(agente)
  }

  async function confirmarAsignacion() {
    if (!pendingAgente || !seleccionados.size) return
    setPendingAgente(null)
    setAsignarLoading(true)
    const res = await asignarAgentesMasivo(Array.from(seleccionados), pendingAgente.id)
    setAsignarLoading(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${seleccionados.size} captaciones asignadas a ${pendingAgente.nombre}`)
    setSeleccionados(new Set())
  }

  function seleccionarSinTelefono() {
    const sinTel = filtered.filter((c) => !hasPhone(c.telefono)).map((c) => c.id)
    if (!sinTel.length) { toast("No hay captaciones sin teléfono en la vista actual"); return }
    setSeleccionados(new Set(sinTel))
  }

  if (tab === "papelera") {
    return (
      <>
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setTab("activas")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver a activas
          </button>
        </div>
        <PapeleraList initialData={eliminadas} isAdmin={isAdmin} />
      </>
    )
  }

  return (
    <>
      {/* Tabs activas / papelera */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab("activas")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "activas" ? "border-violet-500 text-violet-500" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Activas
          <span className={cn("ml-2 text-xs px-1.5 py-0.5 rounded-full", tab === "activas" ? "bg-violet-500/20" : "bg-muted")}>
            {total}
          </span>
        </button>
        <button
          onClick={() => { setTab("papelera"); setSeleccionados(new Set()) }}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            (tab as string) === "papelera" ? "border-red-500 text-red-500" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Trash className="h-3.5 w-3.5" />
          Papelera
          {eliminadas.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
              {eliminadas.length}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTROS.filter((f) => isAdmin || f.key !== "sin_agente").map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                filtro === f.key
                  ? "bg-violet-500/10 text-violet-500 border border-violet-500/30"
                  : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
              )}
            >
              {f.label}
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full", filtro === f.key ? "bg-violet-500/20" : "bg-muted")}>
                {counts[f.key] ?? 0}
              </span>
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            {/* Barra de acciones masivas */}
            {seleccionados.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <span className="text-xs font-medium text-violet-500">{seleccionados.size} seleccionadas</span>

                {/* Asignar agente */}
                {isAdmin && agentes.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowAsignarMenu((v) => !v)}
                      disabled={asignarLoading}
                      className="flex items-center gap-1 text-xs font-medium text-violet-500 hover:text-violet-400 transition-colors disabled:opacity-50"
                    >
                      {asignarLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Asignar agente ▾
                    </button>
                    {showAsignarMenu && (
                      <div className="absolute top-full mt-1 right-0 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-xl py-1">
                        {agentes.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => handleAsignarAgente(a)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                          >
                            <span className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 shrink-0">
                              {`${String(a.nombre).charAt(0)}${a.apellidos ? String(a.apellidos).charAt(0) : ""}`.toUpperCase()}
                            </span>
                            {a.nombre} {a.apellidos ?? ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setConfirmBaja(true)}
                  disabled={bajaLoading}
                  className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {bajaLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  Dar de baja
                </button>
                <button
                  onClick={() => setSeleccionados(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar calle, barrio..."
                className="pl-8 pr-4 py-1.5 rounded-lg border border-input bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-52"
              />
            </div>

            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setVista("grid")}
                className={cn("p-2 transition-colors", vista === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setVista("list")}
                className={cn("p-2 transition-colors", vista === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setVista("pipeline")}
                title="Vista pipeline"
                className={cn("p-2 transition-colors", vista === "pipeline" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <KanbanSquare className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Checkbox seleccionar todos */}
          <button onClick={toggleTodos} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {todosSeleccionados
              ? <CheckSquare className="h-3.5 w-3.5 text-violet-500" />
              : <Square className="h-3.5 w-3.5" />
            }
            {todosSeleccionados ? "Deseleccionar todo" : "Seleccionar todo"}
          </button>
          <p className="text-xs text-muted-foreground">{filtered.length} captaciones</p>

          {isAdmin && (
            <button
              onClick={seleccionarSinTelefono}
              className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors ml-2"
            >
              <PhoneOff className="h-3 w-3" />
              Seleccionar sin tel.
            </button>
          )}
        </div>
      </div>

      {vista === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {visibles.map((c) => (
            <CaptacionCard
              key={c.id}
              cap={c}
              selected={seleccionados.has(c.id)}
              onSelect={(e) => { e.stopPropagation(); toggleSeleccion(c.id) }}
              onClick={() => setSelected(c.id)}
            />
          ))}
        </div>
      ) : vista === "list" ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <ListHeader />
          {visibles.map((c) => (
            <CaptacionRow
              key={c.id}
              cap={c}
              selected={seleccionados.has(c.id)}
              onSelect={() => toggleSeleccion(c.id)}
              onClick={() => setSelected(c.id)}
            />
          ))}
        </div>
      ) : (
        <CaptacionesPipeline captaciones={filtered} onSelect={(id) => setSelected(id)} />
      )}

      {/* Paginador (solo grid/lista) */}
      {!paginado && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pageSafe <= 1}
            className="flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-muted-foreground tabular-nums">
            Página {pageSafe} de {totalPages}
            <span className="mx-2 opacity-40">·</span>
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={pageSafe >= totalPages}
            className="flex items-center gap-1 h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="py-20 text-center space-y-2">
          <Home className="h-8 w-8 text-muted-foreground/20 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {search || filtro !== "todas"
              ? "No hay captaciones con estos filtros"
              : isAdmin
                ? "Aún no hay captaciones. El scraper las importará automáticamente."
                : "No tienes captaciones asignadas. El admin te asignará propiedades."}
          </p>
        </div>
      )}

      <DetailPanel captacionId={selected} onClose={() => setSelected(null)} isAdmin={isAdmin} />

      {/* Confirm dialog: dar de baja masivo */}
      {confirmBaja && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground">¿Dar de baja {seleccionados.size} captaciones?</h3>
              <p className="text-sm text-muted-foreground">Pasarán a la papelera. Puedes restaurarlas desde allí.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmBaja(false)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDarDeBajaMasivo}
                className="h-9 px-4 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Sí, dar de baja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog: asignar agente masivo */}
      {pendingAgente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground">
                ¿Asignar {seleccionados.size} captaciones a {pendingAgente.nombre}?
              </h3>
              <p className="text-sm text-muted-foreground">
                Se sobrescribirá cualquier asignación previa y se notificará al agente.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingAgente(null)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarAsignacion}
                className="h-9 px-4 rounded-md bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
              >
                Sí, asignar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close assign menu when clicking outside */}
      {showAsignarMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowAsignarMenu(false)} />
      )}
    </>
  )
}
