"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import dynamic from "next/dynamic"
import type { FeatureCollection, Geometry } from "geojson"
import {
  History, Plus, X, MapPin, Loader2, Check, Home, Building2,
  Trash2, ExternalLink, BarChart2, ChevronRight, Eye, EyeOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  crearValoracion, eliminarValoracion, getComparablesBarrio,
  type ZonaStat, type Valoracion, type Operacion, type ComparableInmueble, type FactoresMercado,
} from "@/lib/actions/valorador"
import type { BarrioProps } from "./valorador-map"

const ValoradorMapa = dynamic(() => import("./valorador-map").then((m) => m.ValoradorMapa), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      Cargando mapa…
    </div>
  ),
})

type GeoBarrios = FeatureCollection<Geometry, BarrioProps>

function eur(n: number | null | undefined) {
  if (n == null) return "—"
  return `${Math.round(n).toLocaleString("es-ES")} €`
}

// ─── Cálculo de estadísticas en cliente a partir de una lista filtrada ────────
function calcStats(comparables: ComparableInmueble[], excludedIds: Set<number>) {
  const valores = comparables
    .filter((c) => !excludedIds.has(c.id))
    .map((c) => c.precio_m2)
    .sort((a, b) => a - b)

  if (valores.length === 0) return null

  const pct = (p: number) => {
    const idx = (p / 100) * (valores.length - 1)
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    return valores[lo] + (valores[hi] - valores[lo]) * (idx - lo)
  }

  return {
    muestra: valores.length,
    precio_m2_mediana: Math.round(pct(50)),
    precio_m2_p25: Math.round(pct(25)),
    precio_m2_p75: Math.round(pct(75)),
    precio_m2_medio: Math.round(valores.reduce((s, v) => s + v, 0) / valores.length),
  }
}

interface Props {
  statsVenta: ZonaStat[]
  statsAlquiler: ZonaStat[]
  valoracionesIniciales: Valoracion[]
  factores: FactoresMercado
}

export function ValoradorShell({ statsVenta, statsAlquiler, valoracionesIniciales, factores }: Props) {
  const [operacion, setOperacion] = useState<Operacion>("venta")
  const [geojson, setGeojson] = useState<GeoBarrios | null>(null)
  const [selected, setSelected] = useState<{ codbarrio: string; nombre: string } | null>(null)
  const [panel, setPanel] = useState<"nueva" | "historial" | "comparables" | null>(null)
  const [valoraciones, setValoraciones] = useState<Valoracion[]>(valoracionesIniciales)

  // Comparables cargados por barrio
  const [comparables, setComparables] = useState<ComparableInmueble[]>([])
  const [loadingComparables, startLoadComparables] = useTransition()
  // IDs excluidos por el usuario (no se usan en la valoración)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  // Carga del GeoJSON de barrios (asset estático)
  useEffect(() => {
    fetch("/valencia-barrios.geojson")
      .then((r) => r.json())
      .then((g: GeoBarrios) => setGeojson(g))
      .catch(() => toast.error("No se pudo cargar el mapa de barrios"))
  }, [])

  const statsByBarrio = useMemo(() => {
    const src = operacion === "venta" ? statsVenta : statsAlquiler
    return src.reduce((acc, s) => { acc[s.codbarrio] = s; return acc }, {} as Record<string, ZonaStat>)
  }, [operacion, statsVenta, statsAlquiler])

  const zonasConDatos = Object.keys(statsByBarrio).length

  // Stats en vivo recalculadas al excluir comparables
  const liveStats = useMemo(
    () => calcStats(comparables, excludedIds),
    [comparables, excludedIds]
  )

  // Stat que se muestra en la tarjeta del mapa y en el panel de valoración:
  // si hay comparables cargados del mismo barrio → usar liveStats; si no → usar BD
  const statSel = useMemo(() => {
    if (!selected) return undefined
    if (comparables.length > 0 && liveStats) return { ...statsByBarrio[selected.codbarrio], ...liveStats }
    return statsByBarrio[selected.codbarrio]
  }, [selected, statsByBarrio, comparables, liveStats])

  function handleSelectZona(codbarrio: string, nombre: string) {
    setSelected({ codbarrio, nombre })
    setComparables([])
    setExcludedIds(new Set())
  }

  const handleOpenComparables = useCallback(() => {
    if (!selected) return
    setPanel("comparables")
  }, [selected])

  // Cargar comparables cuando el panel está abierto y cambia la zona u operación
  useEffect(() => {
    if (panel !== "comparables" || !selected) return
    let cancelled = false
    startLoadComparables(async () => {
      const data = await getComparablesBarrio(selected.codbarrio, operacion)
      if (!cancelled) { setComparables(data); setExcludedIds(new Set()) }
    })
    return () => { cancelled = true }
  }, [panel, selected, operacion])

  function toggleExcluded(id: number) {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() { setExcludedIds(new Set()) }
  function deselectAll() { setExcludedIds(new Set(comparables.map((c) => c.id))) }

  return (
    <div className="flex flex-col h-full">
      {/* Cabecera */}
      <div className="flex items-start justify-between p-6 pb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Valorador</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {zonasConDatos > 0
              ? `Precio de mercado en ${zonasConDatos} ${zonasConDatos === 1 ? "barrio" : "barrios"} · ${operacion === "venta" ? "venta" : "alquiler"}`
              : "Aún no hay datos de mercado. Ejecuta el scraper para poblar las zonas."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle operación */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => { setOperacion("venta"); setComparables([]); setExcludedIds(new Set()) }}
              className={cn("flex items-center gap-1.5 px-3 h-9 text-sm transition-colors", operacion === "venta" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Home className="h-3.5 w-3.5" /> Venta
            </button>
            <button
              onClick={() => { setOperacion("alquiler"); setComparables([]); setExcludedIds(new Set()) }}
              className={cn("flex items-center gap-1.5 px-3 h-9 text-sm transition-colors", operacion === "alquiler" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Building2 className="h-3.5 w-3.5" /> Alquiler
            </button>
          </div>
          <button
            onClick={() => setPanel("historial")}
            className="h-9 flex items-center gap-1.5 px-3 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
          >
            <History className="h-4 w-4" /> Historial
            {valoraciones.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted tabular-nums">{valoraciones.length}</span>
            )}
          </button>
          <button
            onClick={() => setPanel("nueva")}
            className="h-9 flex items-center gap-1.5 px-3 text-sm rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" /> Nueva valoración
          </button>
        </div>
      </div>

      {/* Contenido: mapa + panel lateral (estilo Leads) */}
      <div className="flex-1 min-h-0 flex gap-4 px-6 pb-6">
        {/* Mapa */}
        <div className="flex-1 min-w-0 relative rounded-xl border border-border overflow-hidden bg-card">
          {geojson ? (
            <ValoradorMapa
              geojson={geojson}
              statsByBarrio={statsByBarrio}
              selected={selected?.codbarrio ?? null}
              onSelectZona={handleSelectZona}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Cargando mapa…</div>
          )}

          {/* Tarjeta de zona seleccionada */}
          {selected && (
            <div className="absolute top-3 right-3 z-[1000] w-72 rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-lg p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="h-4 w-4 text-violet-500 shrink-0" />
                  <p className="text-sm font-semibold truncate">{selected.nombre}</p>
                </div>
                <button onClick={() => { setSelected(null); setComparables([]); setExcludedIds(new Set()) }} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {statSel ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground text-xs">Mediana</span>
                    <span className="font-semibold text-foreground">{statSel.precio_m2_mediana?.toLocaleString("es-ES")} €/m²</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground text-xs">Rango P25–P75</span>
                    <span className="text-xs tabular-nums">{statSel.precio_m2_p25?.toLocaleString("es-ES")}–{statSel.precio_m2_p75?.toLocaleString("es-ES")}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground text-xs">Comparables</span>
                    <span className="text-xs tabular-nums">
                      {liveStats && comparables.length > 0 && excludedIds.size > 0
                        ? <><span className="text-violet-500">{liveStats.muestra}</span>/{comparables.length}</>
                        : statSel.muestra}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {panel !== "comparables" && (
                      <button
                        onClick={handleOpenComparables}
                        className="flex-1 h-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 text-xs flex items-center justify-center gap-1 transition-colors"
                      >
                        <BarChart2 className="h-3.5 w-3.5" />
                        Ver comparables
                        {comparables.length > 0 && <span className="font-medium text-violet-500">({comparables.length})</span>}
                      </button>
                    )}
                    <button
                      onClick={() => setPanel("nueva")}
                      className="flex-1 h-8 rounded-md bg-violet-500/10 text-violet-500 text-xs font-medium hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-1"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                      Valorar aquí
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground/70">Sin datos de mercado en esta zona todavía.</p>
                  {panel !== "comparables" && (
                    <button
                      onClick={handleOpenComparables}
                      className="w-full h-8 rounded-md border border-border text-muted-foreground hover:bg-muted/40 text-xs flex items-center justify-center gap-1 transition-colors"
                    >
                      <BarChart2 className="h-3.5 w-3.5" />
                      Ver comparables
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panel Comparables */}
        {panel === "comparables" && selected && (
        <ComparablesPanel
          barrio={selected.nombre}
          comparables={comparables}
          loading={loadingComparables}
          excludedIds={excludedIds}
          liveStats={liveStats}
          onToggle={toggleExcluded}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onClose={() => setPanel(null)}
          onValorar={() => setPanel("nueva")}
        />
      )}

      {/* Panel Nueva valoración */}
      {panel === "nueva" && geojson && (
        <NuevaValoracionPanel
          geojson={geojson}
          statsByBarrio={statsByBarrio}
          operacion={operacion}
          preselect={selected}
          comparables={comparables}
          excludedIds={excludedIds}
          liveStats={liveStats}
          factores={factores}
          onOpenComparables={handleOpenComparables}
          onClose={() => setPanel(null)}
          onCreada={(v) => { setValoraciones((prev) => [v, ...prev]); setPanel("historial") }}
        />
      )}

        {/* Panel Historial */}
        {panel === "historial" && (
          <HistorialPanel
            valoraciones={valoraciones}
            onClose={() => setPanel(null)}
            onDelete={async (id) => {
              const res = await eliminarValoracion(id)
              if (res.error) { toast.error(res.error); return }
              setValoraciones((prev) => prev.filter((v) => v.id !== id))
            }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Panel: Comparables del barrio ───────────────────────────────────────────
function ComparablesPanel({
  barrio, comparables, loading, excludedIds, liveStats,
  onToggle, onSelectAll, onDeselectAll, onClose, onValorar,
}: {
  barrio: string
  comparables: ComparableInmueble[]
  loading: boolean
  excludedIds: Set<number>
  liveStats: ReturnType<typeof calcStats>
  onToggle: (id: number) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onClose: () => void
  onValorar: () => void
}) {
  const activeCount = comparables.length - excludedIds.size

  return (
    <Drawer
      title={`Comparables · ${barrio}`}
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        {/* Estadísticas en vivo */}
        {liveStats && !loading && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="Mediana" value={`${liveStats.precio_m2_mediana.toLocaleString("es-ES")} €/m²`} highlight />
            <Stat label="P25" value={`${liveStats.precio_m2_p25.toLocaleString("es-ES")}`} />
            <Stat label="P75" value={`${liveStats.precio_m2_p75.toLocaleString("es-ES")}`} />
            <Stat label="Muestra" value={`${activeCount}/${comparables.length}`} />
          </div>
        )}

        {/* Controles de selección */}
        {comparables.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {excludedIds.size > 0
                ? <span className="text-amber-400">{excludedIds.size} excluido{excludedIds.size !== 1 ? "s" : ""} de la valoración</span>
                : "Todos incluidos en la valoración"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onSelectAll}
                disabled={excludedIds.size === 0}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
              >
                <Eye className="h-3 w-3" /> Todos
              </button>
              <button
                onClick={onDeselectAll}
                disabled={activeCount === 0}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
              >
                <EyeOff className="h-3 w-3" /> Ninguno
              </button>
            </div>
          </div>
        )}

        {/* Lista de comparables */}
        {loading ? (
          <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Cargando comparables…</p>
          </div>
        ) : comparables.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No hay comparables activos en esta zona.
          </div>
        ) : (
          <div className="space-y-2">
            {comparables.map((c) => {
              const excluded = excludedIds.has(c.id)
              return (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-lg border p-3 transition-all cursor-pointer select-none",
                    excluded
                      ? "border-border bg-muted/20 opacity-50"
                      : "border-border bg-background hover:border-violet-500/40"
                  )}
                  onClick={() => onToggle(c.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className={cn(
                      "mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
                      excluded ? "border-border bg-background" : "border-violet-500 bg-violet-500"
                    )}>
                      {!excluded && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {Math.round(c.precio_m2).toLocaleString("es-ES")} €/m²
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {c.precio.toLocaleString("es-ES")} €
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        <span>{c.metros} m²</span>
                        {c.habitaciones != null && <span>{c.habitaciones} hab.</span>}
                        {c.banos != null && <span>{c.banos} baños</span>}
                        {c.planta && <span>Pl. {c.planta}</span>}
                        {c.ascensor != null && (
                          <span className={c.ascensor ? "text-emerald-500" : "text-muted-foreground/50"}>
                            {c.ascensor ? "Ascensor" : "Sin ascensor"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1.5 gap-2">
                        <span className="text-[11px] text-muted-foreground/60 truncate">
                          {c.anunciante === "agencia" && c.agencia_nombre ? c.agencia_nombre : "Particular"}
                        </span>
                        <a
                          href={`https://www.idealista.com/inmueble/${c.idealista_id}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] text-violet-500 hover:text-violet-400 flex items-center gap-0.5 shrink-0"
                        >
                          Idealista <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* CTA valorar */}
        {!loading && liveStats && (
          <button
            onClick={onValorar}
            className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <ChevronRight className="h-4 w-4" />
            Valorar en esta zona{excludedIds.size > 0 ? ` (${activeCount} comp.)` : ""}
          </button>
        )}
      </div>
    </Drawer>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn("text-sm font-semibold mt-0.5", highlight ? "text-violet-500" : "text-foreground")}>{value}</p>
    </div>
  )
}

// ─── Motor de ajuste ──────────────────────────────────────────────────────────
const COND_OPTS = [
  { key: "obra_nueva",  label: "Obra nueva",  factor: 1.08 },
  { key: "buen_estado", label: "Buen estado", factor: 1.0 },
  { key: "a_reformar",  label: "A reformar",  factor: 0.85 },
] as const
const PLANTA_OPTS = [
  { key: "bajo",       label: "Bajo",       factor: 0.96 },
  { key: "intermedia", label: "Intermedia", factor: 1.0 },
  { key: "alta",       label: "Alta",       factor: 1.03 },
  { key: "atico",      label: "Ático",      factor: 1.06 },
] as const
const EXTRA_OPTS = [
  { key: "aire",     label: "Aire acond.", pct: 0.02 },
  { key: "parking",  label: "Parking",     pct: 0.04 },
  { key: "trastero", label: "Trastero",    pct: 0.02 },
  { key: "terraza",  label: "Terraza",     pct: 0.03 },
  { key: "piscina",  label: "Piscina/comunes", pct: 0.05 },
] as const

// ─── Panel: Nueva valoración ──────────────────────────────────────────────────
function NuevaValoracionPanel({
  geojson, statsByBarrio, operacion, preselect, comparables, excludedIds, liveStats, factores,
  onOpenComparables, onClose, onCreada,
}: {
  geojson: GeoBarrios
  statsByBarrio: Record<string, ZonaStat>
  operacion: Operacion
  preselect: { codbarrio: string; nombre: string } | null
  comparables: ComparableInmueble[]
  excludedIds: Set<number>
  liveStats: ReturnType<typeof calcStats>
  factores: FactoresMercado
  onOpenComparables: () => void
  onClose: () => void
  onCreada: (v: Valoracion) => void
}) {
  const barrios = useMemo(
    () => geojson.features
      .map((f) => f.properties)
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [geojson]
  )

  const [codbarrio, setCodbarrio] = useState(preselect?.codbarrio ?? "")
  const [direccion, setDireccion] = useState("")
  const [metros, setMetros] = useState("")
  const [habitaciones, setHabitaciones] = useState("")
  const [banos, setBanos] = useState("")
  const [condicion, setCondicion] = useState<string>("buen_estado")
  const [planta, setPlanta] = useState<string>("intermedia")
  const [ascensor, setAscensor] = useState(true)
  const [extras, setExtras] = useState<Set<string>>(new Set())
  const [notas, setNotas] = useState("")
  const [saving, setSaving] = useState(false)

  // Si hay comparables cargados y filtrados → usar esas stats; si no → usar BD
  const stat = useMemo(() => {
    if (comparables.length > 0 && liveStats && preselect?.codbarrio === codbarrio) {
      const base = statsByBarrio[codbarrio]
      return base ? { ...base, ...liveStats } : null
    }
    return statsByBarrio[codbarrio] ?? null
  }, [codbarrio, statsByBarrio, comparables, liveStats, preselect])

  const m2 = parseFloat(metros.replace(",", "."))
  const nombreBarrio = barrios.find((b) => b.codbarrio === codbarrio)?.nombre ?? null

  // Factor de ajuste por características
  const factor = useMemo(() => {
    const fCond = COND_OPTS.find((o) => o.key === condicion)?.factor ?? 1
    const fPlanta = PLANTA_OPTS.find((o) => o.key === planta)?.factor ?? 1
    const fAsc = ascensor ? 1 : factores.ascensorFactor
    const fBanos = banos && parseInt(banos) >= 2 ? 1.02 : 1
    const fExtras = 1 + EXTRA_OPTS.filter((o) => extras.has(o.key)).reduce((s, o) => s + o.pct, 0)
    return fCond * fPlanta * fAsc * fBanos * fExtras
  }, [condicion, planta, ascensor, banos, extras, factores])

  // Tres bandas
  const bandas = useMemo(() => {
    if (!stat || !stat.precio_m2_mediana || !m2 || m2 <= 0) return null
    const med = stat.precio_m2_mediana
    const p25 = stat.precio_m2_p25 ?? Math.round(med * 0.9)
    const p75 = stat.precio_m2_p75 ?? Math.round(med * 1.1)
    return {
      verde:    Math.round(m2 * p25 * factor),
      amarillo: Math.round(m2 * med * factor),
      rojo:     Math.round(m2 * p75 * factor),
    }
  }, [stat, m2, factor])

  const activeCount = comparables.length > 0
    ? comparables.length - excludedIds.size
    : stat?.muestra ?? 0

  function toggleExtra(k: string) {
    setExtras((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  async function guardar() {
    if (!bandas || !stat) return
    setSaving(true)
    const resumen = [
      COND_OPTS.find((o) => o.key === condicion)?.label,
      PLANTA_OPTS.find((o) => o.key === planta)?.label,
      ascensor ? "con ascensor" : "sin ascensor",
      banos ? `${banos} baños` : null,
      ...EXTRA_OPTS.filter((o) => extras.has(o.key)).map((o) => o.label),
    ].filter(Boolean).join(", ")
    const res = await crearValoracion({
      direccion: direccion.trim() || null,
      codbarrio,
      barrio: nombreBarrio,
      metros: m2,
      habitaciones: habitaciones ? parseInt(habitaciones) : null,
      operacion,
      precio_m2_zona: stat.precio_m2_mediana!,
      valor_estimado: bandas.amarillo,
      valor_min: bandas.verde,
      valor_max: bandas.rojo,
      muestra: activeCount,
      notas: [resumen, notas.trim()].filter(Boolean).join(" — ") || null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success("Valoración guardada")
    if (res.valoracion) onCreada(res.valoracion)
  }

  return (
    <Drawer title="Nueva valoración" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Zona / barrio">
          <select
            value={codbarrio}
            onChange={(e) => setCodbarrio(e.target.value)}
            className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Selecciona un barrio…</option>
            {barrios.map((b) => (
              <option key={b.codbarrio} value={b.codbarrio}>
                {b.nombre}{statsByBarrio[b.codbarrio] ? ` · ${statsByBarrio[b.codbarrio].precio_m2_mediana} €/m²` : " (sin datos)"}
              </option>
            ))}
          </select>
        </Field>

        {/* Botón ver/filtrar comparables */}
        {codbarrio && preselect?.codbarrio === codbarrio && (
          <button
            onClick={onOpenComparables}
            className="w-full h-9 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center gap-2 transition-colors"
          >
            <BarChart2 className="h-4 w-4" />
            {comparables.length > 0
              ? excludedIds.size > 0
                ? <><span className="text-amber-400">{excludedIds.size} excluidos</span> · {activeCount} activos usados</>
                : `${comparables.length} comparables · editar`
              : "Ver y editar comparables"}
          </button>
        )}

        <Field label="Dirección (opcional)">
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Ej: Carrer de Cuenca 12"
            className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Metros (m²)">
            <input value={metros} onChange={(e) => setMetros(e.target.value)} inputMode="decimal" placeholder="90"
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
          <Field label="Habitaciones">
            <input value={habitaciones} onChange={(e) => setHabitaciones(e.target.value)} inputMode="numeric" placeholder="3"
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
          <Field label="Baños">
            <input value={banos} onChange={(e) => setBanos(e.target.value)} inputMode="numeric" placeholder="2"
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Condición">
            <select value={condicion} onChange={(e) => setCondicion(e.target.value)}
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              {COND_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Planta">
            <select value={planta} onChange={(e) => setPlanta(e.target.value)}
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              {PLANTA_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
        </div>

        {/* Ascensor */}
        <button
          onClick={() => setAscensor((v) => !v)}
          className={cn("w-full h-9 rounded-md border text-sm flex items-center justify-between px-3 transition-colors",
            ascensor ? "border-violet-500/40 bg-violet-500/5 text-foreground" : "border-border text-muted-foreground")}
        >
          <span>Ascensor</span>
          <span className={cn("text-xs font-medium", ascensor ? "text-violet-500" : "text-muted-foreground")}>
            {ascensor ? "Sí" : `No (×${factores.ascensorFactor})`}
          </span>
        </button>

        {/* Extras */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Extras</label>
          <div className="flex flex-wrap gap-1.5">
            {EXTRA_OPTS.map((o) => {
              const on = extras.has(o.key)
              return (
                <button key={o.key} onClick={() => toggleExtra(o.key)}
                  className={cn("px-2.5 h-8 rounded-md border text-xs transition-colors",
                    on ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border text-muted-foreground hover:text-foreground")}>
                  {o.label} <span className="opacity-60">+{Math.round(o.pct * 100)}%</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Resultado: tres bandas */}
        {codbarrio && !stat && (
          <p className="text-xs text-orange-400 bg-orange-400/10 rounded-md px-3 py-2">
            Este barrio aún no tiene datos de mercado. Elige otro o ejecuta el scraper.
          </p>
        )}
        {bandas && stat && (
          <div className="space-y-2 pt-1">
            <Banda color="green"  label="Venta rápida"    valor={bandas.verde}    />
            <Banda color="amber"  label="Valor estimado"  valor={bandas.amarillo} destacado />
            <Banda color="red"    label="Ambicioso"       valor={bandas.rojo}     />
            <p className="text-[11px] text-muted-foreground/70 pt-1 leading-relaxed">
              Base {stat.precio_m2_mediana} €/m² (mediana de {activeCount} comparables en {nombreBarrio}) ·
              ajuste características ×{factor.toFixed(2)}
              {!ascensor && <> · <span className="text-emerald-500/80">ascensor con datos reales</span></>}.
              El resto de ajustes son estimaciones.
            </p>
          </div>
        )}

        <Field label="Notas (opcional)">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Observaciones…"
            className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
        </Field>

        <button
          onClick={guardar}
          disabled={!bandas || saving}
          className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Guardar valoración
        </button>
      </div>
    </Drawer>
  )
}

function Banda({ color, label, valor, destacado }: { color: "green" | "amber" | "red"; label: string; valor: number; destacado?: boolean }) {
  const cls = {
    green: "border-emerald-500/30 bg-emerald-500/5 text-emerald-500",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    red:   "border-red-500/30 bg-red-500/5 text-red-500",
  }[color]
  const dot = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-red-500" }[color]
  return (
    <div className={cn("flex items-center justify-between rounded-lg border px-4 py-3", cls, destacado && "ring-1 ring-amber-500/30")}>
      <span className="flex items-center gap-2 text-sm">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        {label}
      </span>
      <span className={cn("font-semibold tabular-nums", destacado ? "text-lg" : "text-base")}>{eur(valor)}</span>
    </div>
  )
}

// ─── Panel: Historial ─────────────────────────────────────────────────────────
function HistorialPanel({
  valoraciones, onClose, onDelete,
}: {
  valoraciones: Valoracion[]
  onClose: () => void
  onDelete: (id: number) => void
}) {
  return (
    <Drawer title="Historial de valoraciones" onClose={onClose}>
      {valoraciones.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Aún no has guardado ninguna valoración.
        </div>
      ) : (
        <div className="space-y-2">
          {valoraciones.map((v) => (
            <div key={v.id} className="group rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {v.direccion || v.barrio || "Valoración"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {v.barrio ? `${v.barrio} · ` : ""}{v.metros ? `${v.metros} m²` : ""}{v.habitaciones ? ` · ${v.habitaciones} hab.` : ""} · {v.operacion}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(v.id)}
                  className="text-muted-foreground/40 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-lg font-semibold text-foreground">{eur(v.valor_estimado)}</span>
                <span className="text-xs text-muted-foreground">{eur(v.valor_min)} – {eur(v.valor_max)}</span>
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground/70">
                <span>{v.precio_m2_zona} €/m² · {v.muestra ?? 0} comp.</span>
                <span>
                  {new Date(v.creada_en).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                  {v.autor ? ` · ${v.autor.nombre}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

// ─── Primitivas UI ────────────────────────────────────────────────────────────
function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <aside className={cn("shrink-0 rounded-xl border border-border bg-card h-full flex flex-col overflow-hidden", wide ? "w-[30rem]" : "w-96")}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
