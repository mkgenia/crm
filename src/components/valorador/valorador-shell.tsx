"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import type { FeatureCollection, Geometry } from "geojson"
import { History, Plus, X, MapPin, Loader2, Check, Home, Building2, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  crearValoracion, eliminarValoracion,
  type ZonaStat, type Valoracion, type Operacion,
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

interface Props {
  statsVenta: ZonaStat[]
  statsAlquiler: ZonaStat[]
  valoracionesIniciales: Valoracion[]
}

export function ValoradorShell({ statsVenta, statsAlquiler, valoracionesIniciales }: Props) {
  const [operacion, setOperacion] = useState<Operacion>("venta")
  const [geojson, setGeojson] = useState<GeoBarrios | null>(null)
  const [selected, setSelected] = useState<{ codbarrio: string; nombre: string } | null>(null)
  const [panel, setPanel] = useState<"nueva" | "historial" | null>(null)
  const [valoraciones, setValoraciones] = useState<Valoracion[]>(valoracionesIniciales)

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
  const statSel = selected ? statsByBarrio[selected.codbarrio] : undefined

  function handleSelectZona(codbarrio: string, nombre: string) {
    setSelected({ codbarrio, nombre })
  }

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
              onClick={() => setOperacion("venta")}
              className={cn("flex items-center gap-1.5 px-3 h-9 text-sm transition-colors", operacion === "venta" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Home className="h-3.5 w-3.5" /> Venta
            </button>
            <button
              onClick={() => setOperacion("alquiler")}
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

      {/* Mapa */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="relative h-full rounded-xl border border-border overflow-hidden bg-card">
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
            <div className="absolute top-3 right-3 z-[1000] w-64 rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-lg p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <MapPin className="h-4 w-4 text-violet-500 shrink-0" />
                  <p className="text-sm font-semibold truncate">{selected.nombre}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
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
                    <span className="text-xs tabular-nums">{statSel.muestra}</span>
                  </div>
                  <button
                    onClick={() => setPanel("nueva")}
                    className="mt-1 w-full h-8 rounded-md bg-violet-500/10 text-violet-500 text-xs font-medium hover:bg-violet-500/20 transition-colors"
                  >
                    Valorar en esta zona
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground/70">Sin datos de mercado en esta zona todavía.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Panel Nueva valoración */}
      {panel === "nueva" && geojson && (
        <NuevaValoracionPanel
          geojson={geojson}
          statsByBarrio={statsByBarrio}
          operacion={operacion}
          preselect={selected}
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
  )
}

// ─── Panel: Nueva valoración ──────────────────────────────────────────────────
function NuevaValoracionPanel({
  geojson, statsByBarrio, operacion, preselect, onClose, onCreada,
}: {
  geojson: GeoBarrios
  statsByBarrio: Record<string, ZonaStat>
  operacion: Operacion
  preselect: { codbarrio: string; nombre: string } | null
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
  const [notas, setNotas] = useState("")
  const [saving, setSaving] = useState(false)

  const stat = statsByBarrio[codbarrio]
  const m2 = parseFloat(metros.replace(",", "."))
  const nombreBarrio = barrios.find((b) => b.codbarrio === codbarrio)?.nombre ?? null

  // Estimación en vivo
  const estimacion = useMemo(() => {
    if (!stat || !stat.precio_m2_mediana || !m2 || m2 <= 0) return null
    return {
      valor: Math.round(m2 * stat.precio_m2_mediana),
      min: stat.precio_m2_p25 ? Math.round(m2 * stat.precio_m2_p25) : Math.round(m2 * stat.precio_m2_mediana * 0.9),
      max: stat.precio_m2_p75 ? Math.round(m2 * stat.precio_m2_p75) : Math.round(m2 * stat.precio_m2_mediana * 1.1),
    }
  }, [stat, m2])

  async function guardar() {
    if (!estimacion || !stat) return
    setSaving(true)
    const res = await crearValoracion({
      direccion: direccion.trim() || null,
      codbarrio,
      barrio: nombreBarrio,
      metros: m2,
      habitaciones: habitaciones ? parseInt(habitaciones) : null,
      operacion,
      precio_m2_zona: stat.precio_m2_mediana!,
      valor_estimado: estimacion.valor,
      valor_min: estimacion.min,
      valor_max: estimacion.max,
      muestra: stat.muestra,
      notas: notas.trim() || null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success("Valoración guardada")
    if (res.valoracion) onCreada(res.valoracion)
  }

  return (
    <Drawer title="Nueva valoración" onClose={onClose}>
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

        <Field label="Dirección (opcional)">
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Ej: Carrer de Cuenca 12"
            className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Metros (m²)">
            <input value={metros} onChange={(e) => setMetros(e.target.value)} inputMode="decimal" placeholder="90"
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
          <Field label="Habitaciones">
            <input value={habitaciones} onChange={(e) => setHabitaciones(e.target.value)} inputMode="numeric" placeholder="3"
              className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
        </div>

        {/* Resultado */}
        {codbarrio && !stat && (
          <p className="text-xs text-orange-400 bg-orange-400/10 rounded-md px-3 py-2">
            Este barrio aún no tiene datos de mercado. Elige otro o ejecuta el scraper.
          </p>
        )}
        {estimacion && stat && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor estimado ({operacion})</p>
            <p className="text-2xl font-semibold text-foreground">{eur(estimacion.valor)}</p>
            <p className="text-sm text-muted-foreground">Rango {eur(estimacion.min)} – {eur(estimacion.max)}</p>
            <p className="text-xs text-muted-foreground/70">
              Basado en {stat.precio_m2_mediana} €/m² (mediana) de {stat.muestra} comparables en {nombreBarrio}.
            </p>
          </div>
        )}

        <Field label="Notas (opcional)">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Estado, reforma, observaciones…"
            className="w-full px-2.5 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
        </Field>

        <button
          onClick={guardar}
          disabled={!estimacion || saving}
          className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Guardar valoración
        </button>
      </div>
    </Drawer>
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
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-card border-l border-border h-full flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
      </div>
    </div>
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
