"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import {
  Settings, X, Plus, Trash2, Loader2, Check, MapPin, Zap, ZapOff, Globe,
  Map as MapIcon, Search, ChevronLeft, AlertCircle, Save,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toggleAutoContacto, agregarZona, toggleZona, eliminarZona } from "@/lib/actions/captaciones-config"
import { encodePolyline } from "./zona-map"

// Leaflet requires no SSR
const ZonaViewMap = dynamic(() => import("./zona-map").then(m => m.ZonaViewMap), { ssr: false, loading: () => <MapPlaceholder text="Cargando mapa..." /> })
const ZonaDrawMap = dynamic(() => import("./zona-map").then(m => m.ZonaDrawMap), { ssr: false, loading: () => <MapPlaceholder text="Cargando mapa..." /> })

function MapPlaceholder({ text }: { text: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />{text}
    </div>
  )
}

function MapInfoOverlay({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl p-6 text-center max-w-[220px] shadow-lg">
        <MapIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
        <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

interface Zona {
  id: string
  url: string
  nombre: string
  activa: boolean
  tipo: "nombre" | "zona"
  search_name?: string | null
  coords?: [number, number][] | null
}

interface Props {
  enabled: boolean
  zonas: Zona[]
}

export function CaptacionesConfig({ enabled: initialEnabled, zonas: initialZonas }: Props) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [zonas, setZonas] = useState<Zona[]>(initialZonas)
  const [toggling, setToggling] = useState(false)
  const [loadingZona, setLoadingZona] = useState<string | null>(null)

  // View: list | create
  const [view, setView] = useState<"list" | "create">("list")
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Create-form state
  const [nombre, setNombre] = useState("")
  const [tipo, setTipo] = useState<"nombre" | "zona">("nombre")
  const [searchName, setSearchName] = useState("")
  const [polygonCoords, setPolygonCoords] = useState<[number, number][]>([])
  const [clearSignal, setClearSignal] = useState(0)
  const [saving, setSaving] = useState(false)

  const generatedUrl = useMemo(() => {
    if (tipo === "nombre" && searchName.trim())
      return `https://www.idealista.com/buscar/venta-viviendas/con-publicado_ultimas-24-horas/?q=${encodeURIComponent(searchName.trim())}&ordenado-por=fecha-publicacion-desc`
    if (tipo === "zona" && polygonCoords.length > 2)
      return `https://www.idealista.com/areas/venta-viviendas/con-publicado_ultimas-24-horas/?shape=((${encodePolyline(polygonCoords)}))&ordenado-por=fecha-publicacion-desc`
    return ""
  }, [tipo, searchName, polygonCoords])

  const canSave = nombre.trim().length > 0 && generatedUrl.length > 0

  function goToList() {
    setView("list")
    setNombre("")
    setTipo("nombre")
    setSearchName("")
    setPolygonCoords([])
    setClearSignal(s => s + 1)
  }

  async function handleToggle() {
    setToggling(true)
    const next = !enabled
    setEnabled(next)
    await toggleAutoContacto(next)
    setToggling(false)
    toast.success(next ? "Auto-contacto activado" : "Auto-contacto desactivado")
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    const res = await agregarZona(
      generatedUrl,
      nombre,
      tipo,
      tipo === "nombre" ? searchName.trim() : null,
      tipo === "zona" ? polygonCoords : null,
    )
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    setZonas(z => [...z, {
      id: crypto.randomUUID(),
      url: generatedUrl,
      nombre: nombre.trim(),
      activa: false,
      tipo,
      search_name: tipo === "nombre" ? searchName : null,
      coords: tipo === "zona" ? polygonCoords : null,
    }])
    toast.success("Zona añadida")
    goToList()
  }

  async function handleToggleZona(id: string, activa: boolean) {
    setLoadingZona(id)
    await toggleZona(id, activa)
    setZonas(z => z.map(zona => ({ ...zona, activa: zona.id === id ? activa : activa ? false : zona.activa })))
    setLoadingZona(null)
  }

  async function handleEliminarZona(id: string) {
    if (!confirm("¿Eliminar esta zona?")) return
    setLoadingZona(id)
    await eliminarZona(id)
    setZonas(z => z.filter(zona => zona.id !== id))
    setLoadingZona(null)
    toast.success("Zona eliminada")
  }

  // Which polygon to show in list view map
  const mapZona = hoveredId ? zonas.find(z => z.id === hoveredId) : zonas.find(z => z.activa)
  const showMapOverlay = view === "list"
    ? (!mapZona || mapZona.tipo === "nombre")
    : tipo === "nombre"

  const panelWidth = view === "create" ? "max-w-4xl" : "max-w-sm"

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-colors"
      >
        <Settings className="h-4 w-4" />
        Configuración
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => { setOpen(false); goToList() }} />
      )}

      {/* Panel lateral — se ensancha en create view */}
      <div className={cn(
        "fixed right-0 top-0 h-full w-full z-50 bg-background border-l border-border flex flex-col shadow-2xl transition-all duration-300 ease-out",
        panelWidth,
        open ? "translate-x-0" : "translate-x-full"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            {view === "create" ? (
              <button onClick={goToList} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-4 w-4" />
                <span className="text-sm font-semibold">Nueva zona</span>
              </button>
            ) : (
              <>
                <Settings className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Configuración del captador</h2>
              </>
            )}
          </div>
          <button
            onClick={() => { setOpen(false); goToList() }}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {view === "list" ? (
          /* ── LIST VIEW ── */
          <div className="flex-1 overflow-y-auto p-5 space-y-6">

            {/* Auto-contacto toggle */}
            <section className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Auto-contacto WhatsApp</p>
                <p className="text-xs text-muted-foreground mt-0.5">Cuando se detecta una captación nueva, se envía automáticamente un mensaje al propietario.</p>
              </div>
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all",
                  enabled
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                    : "bg-muted/40 border-border text-muted-foreground hover:border-border/80"
                )}
              >
                <div className="flex items-center gap-3">
                  {toggling ? <Loader2 className="h-5 w-5 animate-spin" /> : enabled ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                  <div className="text-left">
                    <p className="text-sm font-semibold">{enabled ? "Activado" : "Desactivado"}</p>
                    <p className="text-xs opacity-70">{enabled ? "Enviando mensajes automáticamente" : "Sin envío automático"}</p>
                  </div>
                </div>
                <div className={cn("relative h-5 w-9 rounded-full transition-colors", enabled ? "bg-emerald-500" : "bg-border")}>
                  <div className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-4" : "translate-x-0.5")} />
                </div>
              </button>
            </section>

            {/* Zonas */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Zonas de scraping</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Solo una zona puede estar activa a la vez.</p>
                </div>
                <button
                  onClick={() => setView("create")}
                  className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Añadir
                </button>
              </div>

              <div className="space-y-2">
                {zonas.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    <Globe className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    No hay zonas configuradas
                  </div>
                )}
                {zonas.map((zona) => (
                  <div
                    key={zona.id}
                    onMouseEnter={() => setHoveredId(zona.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                      zona.activa ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20"
                    )}
                  >
                    <MapPin className={cn("h-4 w-4 mt-0.5 shrink-0", zona.activa ? "text-emerald-500" : "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className={cn("text-sm font-medium truncate", zona.activa ? "text-foreground" : "text-muted-foreground")}>
                          {zona.nombre}
                        </p>
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0",
                          zona.tipo === "zona" ? "bg-blue-500/15 text-blue-400" : "bg-violet-500/15 text-violet-400"
                        )}>
                          {zona.tipo === "zona" ? "POLÍGONO" : "NOMBRE"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{zona.url}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {loadingZona === zona.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <button
                            onClick={() => handleToggleZona(zona.id, !zona.activa)}
                            className={cn(
                              "text-xs px-2 py-1 rounded-md font-medium transition-colors",
                              zona.activa
                                ? "bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30"
                                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                            )}
                          >
                            {zona.activa ? "Activa" : "Activar"}
                          </button>
                          <button
                            onClick={() => handleEliminarZona(zona.id)}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Info técnica */}
            <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Información técnica</p>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>Webhook respuestas WA:</p>
                <code className="block bg-background border border-border rounded px-2 py-1 text-[10px] break-all">
                  {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhook/captacion-respuesta
                </code>
              </div>
            </section>
          </div>
        ) : (
          /* ── CREATE VIEW: split left/right ── */
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left: form */}
            <div className="w-80 shrink-0 flex flex-col overflow-y-auto p-5 gap-5 border-r border-border">

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nombre de la zona</label>
                <input
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Ruzafa, Valencia Centro..."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Tipo toggle */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tipo de zona</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["nombre", "zona"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setTipo(t); setPolygonCoords([]); setClearSignal(s => s + 1) }}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all",
                        tipo === t
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                          : "border-border bg-muted/20 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "nombre" ? <Search className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
                      {t === "nombre" ? "Por nombre" : "Por polígono"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type-specific input */}
              {tipo === "nombre" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Búsqueda en Idealista</label>
                  <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <input
                      value={searchName}
                      onChange={e => setSearchName(e.target.value)}
                      placeholder="Ej: Ruzafa, Valencia..."
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Cómo dibujar la zona:</p>
                  <div className="space-y-2">
                    {[
                      { n: 1, text: "Haz clic en el lápiz del mapa" },
                      { n: 2, text: "Haz clic para añadir vértices" },
                      { n: 3, text: "Cierra haciendo clic en el primer punto" },
                    ].map(({ n, text }) => (
                      <div key={n} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                        <div className="h-5 w-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-[10px] font-bold shrink-0">{n}</div>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  {polygonCoords.length > 2 && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-xs text-emerald-500 font-medium">Polígono dibujado · {polygonCoords.length - 1} puntos</span>
                    </div>
                  )}
                </div>
              )}

              {/* URL preview */}
              {generatedUrl ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">URL generada</label>
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[10px] font-mono text-muted-foreground break-all leading-relaxed">
                    {generatedUrl}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-lg border border-border bg-muted/10">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{tipo === "nombre" ? "Introduce un nombre para generar la URL" : "Dibuja un polígono en el mapa para generar la URL"}</span>
                </div>
              )}

              {/* Spacer + Save */}
              <div className="mt-auto pt-2 flex gap-2">
                <button
                  onClick={goToList}
                  className="flex-1 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={!canSave || saving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Guardar
                </button>
              </div>
            </div>

            {/* Right: map */}
            <div className="flex-1 relative overflow-hidden">
              {tipo === "zona" ? (
                <ZonaDrawMap
                  onCreated={setPolygonCoords}
                  onClear={() => setPolygonCoords([])}
                  clearSignal={clearSignal}
                />
              ) : (
                <>
                  <ZonaViewMap existingCoords={mapZona?.coords} fitBounds />
                  {showMapOverlay && (
                    <MapInfoOverlay
                      title='Selecciona "Por polígono"'
                      desc="para dibujar el área en el mapa"
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
