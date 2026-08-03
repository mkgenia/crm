"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import dynamic from "next/dynamic"
import type { FeatureCollection, Geometry } from "geojson"
import {
  History, Plus, X, MapPin, Loader2, Check, Home, Building2,
  Trash2, ExternalLink, BarChart2, ChevronRight, Eye, EyeOff, Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  crearValoracion, eliminarValoracion, getComparablesBarrio, getComparablesRadio, buscarCatastro,
  type ZonaStat, type Valoracion, type Operacion, type ComparableInmueble, type FactoresMercado, type UnidadCatastro,
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

// Punto-en-polígono (ray casting) para resolver el barrio desde unas coordenadas
function ringContains(ring: number[][], lng: number, lat: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
function polyContains(coords: number[][][], lng: number, lat: number) {
  if (!coords.length || !ringContains(coords[0], lng, lat)) return false
  for (let k = 1; k < coords.length; k++) if (ringContains(coords[k], lng, lat)) return false
  return true
}
// Centroide aproximado (media del anillo exterior) de un barrio → [lat, lng]
function centroideBarrio(geojson: GeoBarrios, codbarrio: string): [number, number] | null {
  const f = geojson.features.find((ft) => ft.properties.codbarrio === codbarrio)
  if (!f || !f.geometry) return null
  const g = f.geometry
  const ring = g.type === "Polygon"
    ? (g.coordinates as number[][][])[0]
    : g.type === "MultiPolygon"
      ? (g.coordinates as number[][][][])[0][0]
      : null
  if (!ring || !ring.length) return null
  let sx = 0, sy = 0
  for (const [x, y] of ring) { sx += x; sy += y }
  return [sy / ring.length, sx / ring.length]
}

function barrioEnCoords(geojson: GeoBarrios, lng: number, lat: number): BarrioProps | null {
  for (const f of geojson.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === "Polygon" && polyContains((g.coordinates as number[][][]), lng, lat)) return f.properties
    if (g.type === "MultiPolygon") {
      for (const poly of (g.coordinates as number[][][][])) if (polyContains(poly, lng, lat)) return f.properties
    }
  }
  return null
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

  // Comparables cargados (por barrio o por radio)
  const [comparables, setComparables] = useState<ComparableInmueble[]>([])
  const [loadingComparables, startLoadComparables] = useTransition()
  // IDs excluidos por el usuario (no se usan en la valoración)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  // Modo radio (estilo BetterPlace): centro + radio en metros
  const [centro, setCentro] = useState<{ lat: number; lng: number; label: string; codbarrio: string | null; nombre: string | null } | null>(null)
  const [radio, setRadio] = useState(600)

  const mapRef = useRef<HTMLDivElement>(null)

  // Carga del GeoJSON de barrios (asset estático)
  useEffect(() => {
    fetch("/valencia-barrios.geojson")
      .then((r) => r.json())
      .then((g: GeoBarrios) => setGeojson(g))
      .catch(() => toast.error("No se pudo cargar el mapa de barrios"))
  }, [])

  // Click fuera del mapa → deseleccionar la zona (solo en exploración, sin panel)
  useEffect(() => {
    if (!selected || panel) return
    function onDown(e: MouseEvent) {
      if (mapRef.current && !mapRef.current.contains(e.target as Node)) setSelected(null)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [selected, panel])

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
    setCentro(null)
    setComparables([])
    setExcludedIds(new Set())
  }

  const handleOpenComparables = useCallback(() => {
    if (!selected && !centro) return
    setPanel("comparables")
  }, [selected, centro])

  // Modo RADIO: recargar comparables al cambiar centro, radio u operación
  useEffect(() => {
    if (!centro) return
    let cancelled = false
    startLoadComparables(async () => {
      const data = await getComparablesRadio(centro.lat, centro.lng, radio, operacion)
      if (!cancelled) { setComparables(data); setExcludedIds(new Set()) }
    })
    return () => { cancelled = true }
  }, [centro, radio, operacion])

  // Modo ZONA: comparables del barrio (solo si NO estamos en modo radio)
  useEffect(() => {
    if (centro || panel !== "comparables" || !selected) return
    let cancelled = false
    startLoadComparables(async () => {
      const data = await getComparablesBarrio(selected.codbarrio, operacion)
      if (!cancelled) { setComparables(data); setExcludedIds(new Set()) }
    })
    return () => { cancelled = true }
  }, [centro, panel, selected, operacion])

  // Fijar el punto de valoración (desde dirección geocodificada o clic en el mapa)
  function valorarEnDireccion(lat: number, lng: number, label: string) {
    const b = geojson ? barrioEnCoords(geojson, lng, lat) : null
    setCentro({ lat, lng, label, codbarrio: b?.codbarrio ?? null, nombre: b?.nombre ?? null })
  }

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
              onClick={() => { setOperacion("venta"); setComparables([]); setExcludedIds(new Set()); setCentro(null) }}
              className={cn("flex items-center gap-1.5 px-3 h-9 text-sm transition-colors", operacion === "venta" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Home className="h-3.5 w-3.5" /> Venta
            </button>
            <button
              onClick={() => { setOperacion("alquiler"); setComparables([]); setExcludedIds(new Set()); setCentro(null) }}
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
        <div ref={mapRef} className="flex-1 min-w-0 relative rounded-xl border border-border overflow-hidden bg-card">
          {geojson ? (
            <ValoradorMapa
              geojson={geojson}
              statsByBarrio={statsByBarrio}
              selected={selected?.codbarrio ?? null}
              onSelectZona={handleSelectZona}
              centro={centro ? [centro.lat, centro.lng] : null}
              radio={radio}
              valuationMode={panel === "nueva"}
              onMapClick={(lat, lng) => valorarEnDireccion(lat, lng, "Punto en el mapa")}
              comparables={centro ? comparables.filter((c) => c.lat != null && c.lng != null).map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, precio_m2: c.precio_m2, activo: c.activo })) : []}
              excludedIds={excludedIds}
              onToggleComparable={toggleExcluded}
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
                <button onClick={() => { setSelected(null); setComparables([]); setExcludedIds(new Set()); setCentro(null) }} className="text-muted-foreground hover:text-foreground">
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
                      onClick={() => {
                        if (geojson) {
                          const c = centroideBarrio(geojson, selected.codbarrio)
                          if (c) valorarEnDireccion(c[0], c[1], selected.nombre)
                        }
                        setPanel("nueva")
                      }}
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
        {panel === "comparables" && (selected || centro) && (
        <ComparablesPanel
          barrio={centro ? `${radio >= 1000 ? `${(radio / 1000).toFixed(1)} km` : `${radio} m`} · ${centro.label}` : selected!.nombre}
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
          centro={centro}
          radio={radio}
          onRadioChange={setRadio}
          onValorarDireccion={valorarEnDireccion}
          onOpenComparables={handleOpenComparables}
          onToggleComparable={toggleExcluded}
          onSelectAllComparables={selectAll}
          onDeselectAllComparables={deselectAll}
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
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-foreground">
                            {Math.round(c.precio_m2).toLocaleString("es-ES")} €/m²
                          </span>
                          {c.activo === false && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-zinc-500/20 text-zinc-400 tracking-wide">
                              Vendido/Retirado
                            </span>
                          )}
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
  { key: "1",          label: "Planta 1",   factor: 0.98 },
  { key: "2",          label: "Planta 2",   factor: 1.00 },
  { key: "3",          label: "Planta 3",   factor: 1.00 },
  { key: "4",          label: "Planta 4",   factor: 1.02 },
  { key: "5",          label: "Planta 5",   factor: 1.02 },
  { key: "6",          label: "Planta 6",   factor: 1.03 },
  { key: "7+",         label: "Planta 7+",  factor: 1.04 },
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
  centro, radio, onRadioChange, onValorarDireccion,
  onOpenComparables, onToggleComparable, onSelectAllComparables, onDeselectAllComparables,
  onClose, onCreada,
}: {
  geojson: GeoBarrios
  statsByBarrio: Record<string, ZonaStat>
  operacion: Operacion
  preselect: { codbarrio: string; nombre: string } | null
  comparables: ComparableInmueble[]
  excludedIds: Set<number>
  liveStats: ReturnType<typeof calcStats>
  factores: FactoresMercado
  centro: { lat: number; lng: number; label: string; codbarrio: string | null; nombre: string | null } | null
  radio: number
  onRadioChange: (r: number) => void
  onValorarDireccion: (lat: number, lng: number, label: string) => void
  onOpenComparables: () => void
  onToggleComparable: (id: number) => void
  onSelectAllComparables: () => void
  onDeselectAllComparables: () => void
  onClose: () => void
  onCreada: (v: Valoracion) => void
}) {
  const radioMode = centro != null
  // El barrio se deriva del punto de valoración (centro) o de la zona seleccionada
  const codbarrio = centro?.codbarrio ?? preselect?.codbarrio ?? ""
  const nombreBarrio = centro?.nombre ?? preselect?.nombre ?? null

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
  const [descuento, setDescuento] = useState(true)

  // Toggle inline comparables list in panel
  const [showComparablesList, setShowComparablesList] = useState(false)

  // Búsqueda por dirección (geocode + Catastro → radio + fincas)
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoMsg, setGeoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [unidades, setUnidades] = useState<UnidadCatastro[]>([])
  const [unidadSel, setUnidadSel] = useState<string | null>(null)
  const [totalPlantas, setTotalPlantas] = useState<number | null>(null)
  const [plantaNum, setPlantaNum] = useState<number | null>(null)

  async function buscarDireccion() {
    const q = direccion.trim()
    if (!q) return
    setGeoLoading(true)
    setGeoMsg(null)
    setUnidades([]); setUnidadSel(null); setTotalPlantas(null); setPlantaNum(null)
    const g = await buscarCatastro(q)
    setGeoLoading(false)
    if (!g) { setGeoMsg({ ok: false, text: "No se encontró la dirección" }); return }
    setDireccion(g.direccion)
    // Fija el punto de valoración (el shell resuelve el barrio)
    onValorarDireccion(g.lat, g.lng, g.direccion)
    const barrio = barrioEnCoords(geojson, g.lng, g.lat)
    setUnidades(g.unidades)
    setTotalPlantas(g.totalPlantas ?? null)
    setGeoMsg({
      ok: true,
      text: `${g.direccion}${barrio ? ` · ${barrio.nombre}` : ""}${g.unidades.length ? ` · ${g.unidades.length} fincas en Catastro` : ""}${g.totalPlantas ? ` (${g.totalPlantas} plantas)` : ""}`,
    })
  }

  // Mapea la planta del Catastro a las opciones del selector
  function plantaCatastro(pt: string): string {
    const p = pt.toUpperCase().trim()
    if (["B0", "BJ", "PB", "EN", "BA", "00", "0"].includes(p)) return "bajo"
    if (["AT", "ÁT", "ATICO", "ÁTICO", "SS"].includes(p)) return "atico"

    const match = p.match(/\d+/)
    if (match) {
      const num = parseInt(match[0], 10)
      if (num === 0) return "bajo"
      if (num >= 7) return "7+"
      return String(num)
    }
    return "3"
  }

  function elegirUnidad(u: UnidadCatastro) {
    setUnidadSel(u.rc)
    if (u.superficie) setMetros(String(u.superficie))
    if (u.planta) setPlanta(plantaCatastro(u.planta))
    if (u.plantaNum != null) {
      setPlantaNum(u.plantaNum)
    } else if (u.planta) {
      const m = u.planta.match(/\d+/)
      setPlantaNum(m ? parseInt(m[0], 10) : null)
    }
  }

  // Base de precios: en modo radio o con comparables cargados → usar liveStats;
  // si no → stats de la zona por barrio.
  const stat = useMemo(() => {
    if (comparables.length > 0 && liveStats) {
      const base = statsByBarrio[codbarrio]
      return { ...(base ?? {}), ...liveStats } as ZonaStat
    }
    return statsByBarrio[codbarrio] ?? null
  }, [codbarrio, statsByBarrio, comparables, liveStats])

  const m2 = parseFloat(metros.replace(",", "."))

  // Penalización por falta de ascensor según la altura real de la planta:
  const ascensorPenalty = useMemo(() => {
    if (ascensor) return 1
    if (plantaNum != null) {
      if (plantaNum <= 0) return 1.0 // Bajo: sin penalización
      if (plantaNum === 1) return 0.98 // 1º sin ascensor: -2%
      if (plantaNum === 2) return 0.95 // 2º sin ascensor: -5%
      if (plantaNum === 3) return 0.92 // 3º sin ascensor: -8%
      if (plantaNum === 4) return 0.88 // 4º sin ascensor: -12%
      return 0.85 // 5º+ / Ático sin ascensor: -15%
    }
    if (planta === "bajo") return 1.0
    if (planta === "intermedia") return 0.95
    if (planta === "alta") return 0.90
    if (planta === "atico") return 0.85
    return factores.ascensorFactor
  }, [ascensor, plantaNum, planta, factores])

  // Multiplicador por habitaciones (estudio/1hab +4%, 2hab 0%, 3hab +2%, 4+hab +4%)
  const fHab = useMemo(() => {
    const n = parseInt(habitaciones)
    if (isNaN(n) || n <= 0) return 1.0
    if (n === 1) return 1.04
    if (n === 2) return 1.00
    if (n === 3) return 1.02
    return 1.04
  }, [habitaciones])

  // Multiplicador por baños (1 baño 0%, 2 baños +3%, 3+ baños +6%)
  const fBanos = useMemo(() => {
    const n = parseInt(banos)
    if (isNaN(n) || n <= 0) return 1.0
    if (n === 1) return 1.00
    if (n === 2) return 1.03
    return 1.06
  }, [banos])

  // Factor de ajuste total por características
  const factor = useMemo(() => {
    const fCond = COND_OPTS.find((o) => o.key === condicion)?.factor ?? 1
    const fPlanta = PLANTA_OPTS.find((o) => o.key === planta)?.factor ?? 1
    const fAsc = ascensorPenalty
    const fExtras = 1 + EXTRA_OPTS.filter((o) => extras.has(o.key)).reduce((s, o) => s + o.pct, 0)
    return fCond * fPlanta * fAsc * fHab * fBanos * fExtras
  }, [condicion, planta, ascensorPenalty, fHab, fBanos, extras])

  // Tres bandas de precio (estilo BetterPlace)
  const bandas = useMemo(() => {
    if (!stat || !stat.precio_m2_mediana || !m2 || m2 <= 0) return null
    const med = stat.precio_m2_mediana
    const p25 = stat.precio_m2_p25 ?? Math.round(med * 0.9)
    const p75 = stat.precio_m2_p75 ?? Math.round(med * 1.15)
    const desc = descuento ? 0.85 : 1

    // 1. Precio de venta (Verde): Valor indicado / real de venta (con descuento venta real)
    const verde = Math.round(m2 * p25 * factor * desc)
    // 2. Venta poco probable (Amarillo): Precio de anuncio medio
    const amarillo = Math.max(Math.round(verde * 1.10), Math.round(m2 * med * factor))
    // 3. Fuera de mercado (Rojo): Rango alto sobrevalorado (P75)
    const rojo = Math.max(Math.round(amarillo * 1.12), Math.round(m2 * p75 * factor * 1.05))

    return { verde, amarillo, rojo }
  }, [stat, m2, factor, descuento])

  const vendidos = comparables.filter((c) => c.activo === false).length
  const activeCount = comparables.length > 0
    ? comparables.filter((c) => !excludedIds.has(c.id)).length
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
      radioMode ? `radio ${radio}m` : null,
      descuento ? "−15% venta real" : null,
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

  const [paso, setPaso] = useState<1 | 2 | 3>(1)

  return (
    <Drawer title="Nueva valoración" onClose={onClose} wide>
      <div className="space-y-4">
        {/* Barra superior de pasos */}
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-muted/30 border border-border text-xs mb-2">
          <button
            onClick={() => setPaso(1)}
            className={cn("py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 transition-all select-none",
              paso === 1 ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}
          >
            <span className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              paso === 1 ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground")}>1</span>
            <span className="truncate">Ubicación</span>
          </button>

          <button
            onClick={() => setPaso(2)}
            className={cn("py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 transition-all select-none",
              paso === 2 ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}
          >
            <span className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              paso === 2 ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground")}>2</span>
            <span className="truncate">Características</span>
          </button>

          <button
            onClick={() => setPaso(3)}
            className={cn("py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 transition-all select-none",
              paso === 3 ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}
          >
            <span className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              paso === 3 ? "bg-violet-500 text-white" : "bg-muted text-muted-foreground")}>3</span>
            <span className="truncate">Comparables</span>
          </button>
        </div>

        {/* ─── PASO 1: Ubicación e Inmueble (Catastro / Mapa / Dirección) ─── */}
        {paso === 1 && (
          <div className="space-y-4">
            <Field label="Dirección o clic en el mapa">
              <div className="flex gap-2">
                <input
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarDireccion() } }}
                  placeholder="Ej: Carrer de Sueca 10"
                  className="flex-1 h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={buscarDireccion}
                  disabled={geoLoading || !direccion.trim()}
                  className="h-9 px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {geoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Buscar
                </button>
              </div>
              {geoMsg && (
                <p className={cn("text-xs mt-1.5 flex items-center gap-1", geoMsg.ok ? "text-emerald-500" : "text-amber-400")}>
                  {geoMsg.ok && <MapPin className="h-3 w-3" />}{geoMsg.text}
                </p>
              )}
            </Field>

            {/* Fincas del Catastro (piso/puerta/uso/m²) */}
            {unidades.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Fincas del Catastro · elige la del inmueble (autorrellena m² y planta)
                </label>
                <div className="max-h-52 overflow-y-auto scrollbar-thin rounded-lg border border-border divide-y divide-border/60">
                  {unidades.map((u) => {
                    const sel = unidadSel === u.rc
                    const esViv = /residencial/i.test(u.uso)
                    return (
                      <button
                        key={u.rc}
                        onClick={() => elegirUnidad(u)}
                        className={cn("w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors",
                          sel ? "bg-violet-500/10 border-l-2 border-l-violet-500" : "hover:bg-muted/40")}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {u.planta ? `Planta ${u.planta}` : "—"}{u.puerta ? ` · Pta ${u.puerta}` : ""}{u.escalera && u.escalera !== "1" ? ` · Esc ${u.escalera}` : ""}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            <span className={cn(esViv ? "text-emerald-500/80" : "text-amber-400/80")}>{u.uso}</span>
                            {u.superficie ? ` · ${u.superficie} m²` : ""}{u.anio ? ` · ${u.anio}` : ""}
                          </p>
                        </div>
                        {sel && <Check className="h-4 w-4 text-violet-500 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Sin punto todavía → guía */}
            {!radioMode && (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                <MapPin className="h-5 w-5 mx-auto mb-1.5 opacity-40" />
                Busca una dirección o <span className="text-foreground">haz clic en el mapa</span> para
                fijar la ubicación exacta.
              </div>
            )}

            {/* Botón avance a paso 2 */}
            <button
              onClick={() => setPaso(2)}
              disabled={!radioMode && !direccion.trim()}
              className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 mt-4"
            >
              Siguiente: Datos y Características <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ─── PASO 2: Datos y Características del Inmueble ─── */}
        {paso === 2 && (
          <div className="space-y-4">
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
                <select
                  value={planta}
                  onChange={(e) => {
                    const val = e.target.value
                    setPlanta(val)
                    const n = parseInt(val, 10)
                    if (!isNaN(n)) setPlantaNum(n)
                    else if (val === "bajo") setPlantaNum(0)
                    else if (val === "atico") setPlantaNum(7)
                  }}
                  disabled={!!unidadSel}
                  className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
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
              <span className={cn("text-xs font-medium", ascensor ? "text-violet-500" : "text-amber-500")}>
                {ascensor
                  ? "Sí"
                  : `No (${ascensorPenalty === 1 ? "sin penalización en bajo" : `−${Math.round((1 - ascensorPenalty) * 100)}%`})`}
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

            {/* Toggle descuento 15% */}
            <button
              onClick={() => setDescuento((v) => !v)}
              className={cn("w-full rounded-md border px-3 py-2 flex items-center justify-between transition-colors",
                descuento ? "border-emerald-500/40 bg-emerald-500/5" : "border-border")}
            >
              <span className="text-sm text-left">
                Descuento venta real <span className="text-muted-foreground">(−15%)</span>
                <span className="block text-[11px] text-muted-foreground/70">Los pisos suelen venderse por debajo del anuncio</span>
              </span>
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full shrink-0",
                descuento ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}>
                {descuento ? "Aplicado" : "No"}
              </span>
            </button>

            {/* Desglose de factores de ajuste */}
            <div className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Ajuste por características</span>
                <span className="font-bold text-violet-400 tabular-nums">
                  ×{factor.toFixed(2)} ({factor >= 1 ? `+${Math.round((factor - 1) * 100)}%` : `−${Math.round((1 - factor) * 100)}%`})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] text-muted-foreground border-t border-border/60">
                <div>
                  <span className="opacity-70">Estado:</span>{" "}
                  <span className="font-medium text-foreground">{COND_OPTS.find(o => o.key === condicion)?.label}</span>
                </div>
                <div>
                  <span className="opacity-70">Planta:</span>{" "}
                  <span className="font-medium text-foreground">{PLANTA_OPTS.find(o => o.key === planta)?.label}</span>
                </div>
                <div>
                  <span className="opacity-70">Ascensor:</span>{" "}
                  <span className={cn("font-medium", ascensor ? "text-emerald-500" : "text-amber-500")}>
                    {ascensor ? "Sí" : ascensorPenalty === 1 ? "Bajo (0%)" : `−${Math.round((1 - ascensorPenalty) * 100)}%`}
                  </span>
                </div>
                <div>
                  <span className="opacity-70">Habitaciones:</span>{" "}
                  <span className="font-medium text-foreground">{habitaciones || "—"} ({fHab >= 1 ? `+${Math.round((fHab - 1) * 100)}%` : `${Math.round((fHab - 1) * 100)}%`})</span>
                </div>
                <div>
                  <span className="opacity-70">Baños:</span>{" "}
                  <span className="font-medium text-foreground">{banos || "—"} ({fBanos >= 1 ? `+${Math.round((fBanos - 1) * 100)}%` : `${Math.round((fBanos - 1) * 100)}%`})</span>
                </div>
                <div>
                  <span className="opacity-70">Extras:</span>{" "}
                  <span className="font-medium text-foreground">
                    +{Math.round(EXTRA_OPTS.filter(o => extras.has(o.key)).reduce((s, o) => s + o.pct, 0) * 100)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Vista previa estimación preliminar */}
            {bandas && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Estimación preliminar de valor</p>
                <TresBandasBetterPlace
                  verde={bandas.verde}
                  amarillo={bandas.amarillo}
                  rojo={bandas.rojo}
                  m2={m2}
                />
              </div>
            )}

            {/* Navegación Paso 2 */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setPaso(1)}
                className="h-10 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted/40 transition-colors"
              >
                ← Atrás
              </button>
              <button
                onClick={() => setPaso(3)}
                disabled={!m2 || m2 <= 0}
                className="flex-1 h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Siguiente: Ajustar Comparables <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ─── PASO 3: Ajuste Fino con Comparables del Entorno ─── */}
        {paso === 3 && (
          <div className="space-y-4">
            {/* Slider de radio de búsqueda */}
            {radioMode && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Radio de comparación</span>
                  <span className="font-medium text-violet-400 tabular-nums">
                    {radio >= 1000 ? `${(radio / 1000).toFixed(1)} km` : `${radio} m`}
                  </span>
                </div>
                <input
                  type="range" min={200} max={2500} step={100} value={radio}
                  onChange={(e) => onRadioChange(parseInt(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <p className="text-xs text-muted-foreground/70">
                  {comparables.length > 0
                    ? <><span className="text-foreground font-medium">{activeCount}</span> comparables{vendidos > 0 ? <> · <span className="text-zinc-400">incluye {vendidos} vendidos/retirados</span></> : null}</>
                    : "Sin pisos en este radio — amplíalo"}
                </p>
              </div>
            )}

            {/* Lista interactiva de comparables con casillas para incluir/excluir */}
            {comparables.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">Selecciona los comparables que influyen en el precio:</span>
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={onSelectAllComparables} className="text-violet-400 hover:underline">Incluir todos</button>
                    <button onClick={onDeselectAllComparables} className="text-muted-foreground hover:underline">Excluir todos</button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-border/40 rounded-lg border border-border bg-background scrollbar-thin">
                  {comparables.map((c) => {
                    const excluded = excludedIds.has(c.id)
                    return (
                      <div
                        key={c.id}
                        onClick={() => onToggleComparable(c.id)}
                        className={cn(
                          "px-3 py-2 flex items-center justify-between text-xs cursor-pointer select-none transition-colors",
                          excluded ? "opacity-40 bg-muted/20" : "hover:bg-muted/40"
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                            excluded ? "border-border bg-background" : "border-violet-500 bg-violet-500"
                          )}>
                            {!excluded && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-foreground">{Math.round(c.precio_m2).toLocaleString("es-ES")} €/m²</span>
                            {c.activo === false && (
                              <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded bg-zinc-500/20 text-zinc-400 tracking-wide ml-1.5">Vendido</span>
                            )}
                            <span className="text-muted-foreground text-[11px] ml-2">
                              {c.metros} m² · {c.habitaciones ?? "—"} hab · {c.banos ?? "—"} baños
                            </span>
                            {c.cambio && c.cambio.delta != null && c.cambio.direccion && (
                              <span className={cn(
                                "text-[10px] font-medium ml-2 whitespace-nowrap",
                                c.cambio.direccion === "decrease" ? "text-amber-400" : "text-red-400"
                              )}>
                                {c.cambio.direccion === "decrease" ? "↓" : "↑"} {Math.abs(Math.round(c.cambio.delta)).toLocaleString("es-ES")} €
                                {c.cambio.pct != null ? ` (${c.cambio.pct > 0 ? "+" : ""}${c.cambio.pct}%)` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="font-medium text-foreground tabular-nums shrink-0 ml-2">
                          {Math.round(c.precio).toLocaleString("es-ES")} €
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No hay comparables individuales en esta zona. Se utilizarán las estadísticas medias del barrio.
              </div>
            )}

            {/* Resultado: Histograma + tres bandas de precio estilo BetterPlace */}
            {codbarrio && !stat && !radioMode && (
              <p className="text-xs text-orange-400 bg-orange-400/10 rounded-md px-3 py-2">
                Este barrio aún no tiene datos de mercado. Elige otro o ejecuta el scraper.
              </p>
            )}
            {bandas && stat && (
              <div className="space-y-3 pt-1">
                <PrecioHistograma
                  comparables={comparables}
                  excludedIds={excludedIds}
                  valorEstimado={bandas.verde}
                  valorMin={bandas.verde}
                  valorMax={bandas.rojo}
                  m2={m2}
                  stat={stat}
                />
                <TresBandasBetterPlace
                  verde={bandas.verde}
                  amarillo={bandas.amarillo}
                  rojo={bandas.rojo}
                  m2={m2}
                />
                <p className="text-[11px] text-muted-foreground/70 pt-1 leading-relaxed">
                  Base {stat.precio_m2_mediana} €/m² (mediana de {activeCount} comparables
                  {radioMode ? ` en ${radio >= 1000 ? `${(radio / 1000).toFixed(1)} km` : `${radio} m`}` : nombreBarrio ? ` en ${nombreBarrio}` : ""}) ·
                  características ×{factor.toFixed(2)}
                  {descuento && <> · <span className="text-emerald-500/80">−15% venta real</span></>}.
                </p>
              </div>
            )}

            {/* Campo opcional de Notas */}
            <Field label="Notas (opcional)">
              <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Observaciones de la valoración…"
                className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
            </Field>

            {/* Navegación y guardar */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setPaso(2)}
                className="h-10 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted/40 transition-colors"
              >
                ← Atrás
              </button>
              <button
                onClick={guardar}
                disabled={!bandas || saving}
                className="flex-1 h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Guardar valoración
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}

function TresBandasBetterPlace({
  verde, amarillo, rojo, m2
}: {
  verde: number
  amarillo: number
  rojo: number
  m2: number
}) {
  const pm2Verde = m2 > 0 ? Math.round(verde / m2) : 0
  const pm2Amarillo = m2 > 0 ? Math.round(amarillo / m2) : 0
  const pm2Rojo = m2 > 0 ? Math.round(rojo / m2) : 0

  return (
    <div className="grid grid-cols-3 gap-2 pt-1">
      {/* 1. Precio de venta (Verde - Recomendado) */}
      <div className="rounded-r-lg border border-border border-l-[4px] border-l-emerald-500 bg-emerald-500/10 p-2.5 space-y-1">
        <p className="text-xs font-bold text-foreground truncate">Precio de venta</p>
        <p className="text-base font-bold text-foreground tabular-nums tracking-tight">
          {verde.toLocaleString("es-ES")}€
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {pm2Verde.toLocaleString("es-ES")}€/m²
        </p>
      </div>

      {/* 2. Venta poco probable (Amarillo) */}
      <div className="rounded-r-lg border border-border border-l-[4px] border-l-amber-500 bg-muted/30 p-2.5 space-y-1">
        <p className="text-xs font-bold text-foreground truncate">Venta poco probable</p>
        <p className="text-base font-bold text-foreground tabular-nums tracking-tight">
          {amarillo.toLocaleString("es-ES")}€
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {pm2Amarillo.toLocaleString("es-ES")}€/m²
        </p>
      </div>

      {/* 3. Fuera de mercado (Rojo) */}
      <div className="rounded-r-lg border border-border border-l-[4px] border-l-red-500 bg-muted/30 p-2.5 space-y-1">
        <p className="text-xs font-bold text-foreground truncate">Fuera de mercado</p>
        <p className="text-base font-bold text-foreground tabular-nums tracking-tight">
          {rojo.toLocaleString("es-ES")}€
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {pm2Rojo.toLocaleString("es-ES")}€/m²
        </p>
      </div>
    </div>
  )
}

// ─── Histograma de distribución de precios ────────────────────────────────────
function PrecioHistograma({
  comparables, excludedIds, valorEstimado, valorMin, valorMax, m2, stat,
}: {
  comparables: ComparableInmueble[]
  excludedIds: Set<number>
  valorEstimado: number
  valorMin: number
  valorMax: number
  m2: number
  stat: ZonaStat
}) {
  const precios = comparables
    .filter((c) => !excludedIds.has(c.id))
    .map((c) => c.precio_m2)
    .filter((p) => p > 0)
    .sort((a, b) => a - b)

  const hasComparables = precios.length >= 5

  // Rango del eje siempre desde stat p25*0.85 → p75*1.15 para que el marcador
  // siempre quede visible aunque no haya comparables individuales
  const axisMin = hasComparables
    ? Math.min(precios[0], (stat.precio_m2_p25 ?? precios[0]) * 0.9)
    : (stat.precio_m2_p25 ?? (stat.precio_m2_mediana ?? 0)) * 0.82
  const axisMax = hasComparables
    ? Math.max(precios[precios.length - 1], (stat.precio_m2_p75 ?? precios[precios.length - 1]) * 1.1)
    : (stat.precio_m2_p75 ?? (stat.precio_m2_mediana ?? 0)) * 1.18

  if (!axisMin || !axisMax || axisMin >= axisMax) return null

  const estimadoPm2 = m2 > 0 ? valorEstimado / m2 : null
  const minPm2      = m2 > 0 ? valorMin / m2 : null
  const maxPm2      = m2 > 0 ? valorMax / m2 : null

  const toPercent = (v: number) =>
    Math.min(99, Math.max(1, ((v - axisMin) / (axisMax - axisMin)) * 100))

  // Percentil del estimado
  const percentil = hasComparables && estimadoPm2 != null
    ? Math.round((precios.filter((p) => p <= estimadoPm2).length / precios.length) * 100)
    : null

  const pctLabel = percentil == null ? null
    : percentil < 33 ? { text: "Por debajo de la zona", cls: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" }
    : percentil < 60 ? { text: "En la media de la zona", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" }
    : percentil < 80 ? { text: "Por encima de la media", cls: "text-orange-400 bg-orange-500/10 border-orange-500/20" }
    : { text: "En el rango alto de la zona", cls: "text-red-500 bg-red-500/10 border-red-500/20" }

  const markerLeft = estimadoPm2 != null ? toPercent(estimadoPm2) : null
  const zonaLeft = minPm2 != null ? toPercent(minPm2) : null
  const zonaWidth = minPm2 != null && maxPm2 != null ? toPercent(maxPm2) - toPercent(minPm2) : null

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Posición en el mercado
        </p>
        {pctLabel && (
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", pctLabel.cls)}>
            {pctLabel.text}
          </span>
        )}
      </div>

      {/* Barra de posición: gradiente barato→caro + rango de zona + marcador */}
      <div className="pt-7 pb-1">
        <div
          className="relative h-2.5 rounded-full"
          style={{ background: "linear-gradient(90deg, hsl(150 55% 45%), hsl(48 85% 55%), hsl(0 70% 52%))" }}
        >
          {/* Rango de la zona (P25–P75) */}
          {zonaLeft != null && zonaWidth != null && (
            <div
              className="absolute -top-1 -bottom-1 rounded-full bg-white/10 ring-1 ring-white/50"
              style={{ left: `${zonaLeft}%`, width: `${zonaWidth}%` }}
            />
          )}
          {/* Marcador del valor estimado */}
          {markerLeft != null && estimadoPm2 != null && (
            <div className="absolute -top-7 -translate-x-1/2 flex flex-col items-center z-10" style={{ left: `${markerLeft}%` }}>
              <span className="bg-amber-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md shadow-amber-500/20 whitespace-nowrap">
                {Math.round(estimadoPm2).toLocaleString("es-ES")} €/m²
              </span>
              <span className="mt-1 h-3.5 w-3.5 rounded-full bg-amber-400 border-2 border-background shadow" />
            </div>
          )}
        </div>

        {/* Eje */}
        <div className="relative h-4 mt-2.5 text-[10px] text-muted-foreground/50 tabular-nums">
          <span className="absolute left-0">{Math.round(axisMin).toLocaleString("es-ES")} €/m²</span>
          {zonaLeft != null && zonaWidth != null && (
            <span className="absolute -translate-x-1/2 text-muted-foreground/70" style={{ left: `${zonaLeft + zonaWidth / 2}%` }}>
              zona
            </span>
          )}
          <span className="absolute right-0">{Math.round(axisMax).toLocaleString("es-ES")} €/m²</span>
        </div>
      </div>

      {/* Fuente */}
      <p className="text-[10px] text-muted-foreground/40 text-right">
        {hasComparables ? `${precios.length} comparables activos` : `Estadística de barrio · ${stat.muestra} comparables`}
      </p>
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
