"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import {
  Settings, X, Plus, Trash2, Loader2, Check, MapPin, Zap, ZapOff, Globe,
  Map as MapIcon, ChevronLeft, AlertCircle, Save, ExternalLink, GripVertical,
  Wallet, Send, Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  toggleAutoContacto, agregarZona, toggleZona, eliminarZona, setLimiteDiario, reordenarZonas, setRitmo,
  type ApifyUso, type Operacion, type TipoInmueble, type TipoZona, type Ritmo,
} from "@/lib/actions/captaciones-config"
import { encodePolyline } from "./polyline"
import { AvisosDestinos } from "./avisos-destinos"
import { RepartoAgentes } from "./reparto-agentes"
import type { EstadoAsignacion } from "@/lib/actions/asignacion"

// Estas dos listas son las que hacen que una zona nueva se pueda crear desde aquí
// sin tocar n8n: de ellas salen el segmento de la URL de Idealista y el
// vocabulario del mensaje. `enMensaje` es cómo llamará el WhatsApp al inmueble,
// que es la diferencia entre escribirle a alguien sobre "su piso" o sobre "su nave".
const OPERACIONES: { valor: Operacion; etiqueta: string }[] = [
  { valor: "venta", etiqueta: "Venta" },
  { valor: "alquiler", etiqueta: "Alquiler" },
]

const TIPOS_INMUEBLE: { valor: TipoInmueble; etiqueta: string; enMensaje: string }[] = [
  { valor: "viviendas", etiqueta: "Viviendas", enMensaje: "vivienda" },
  { valor: "locales", etiqueta: "Locales", enMensaje: "local" },
  { valor: "oficinas", etiqueta: "Oficinas", enMensaje: "oficina" },
  { valor: "garajes", etiqueta: "Garajes", enMensaje: "plaza de garaje" },
  { valor: "trasteros", etiqueta: "Trasteros", enMensaje: "trastero" },
  { valor: "terrenos", etiqueta: "Terrenos", enMensaje: "terreno" },
]

const RITMOS: { valor: Ritmo; etiqueta: string; cada: string; aviso: string }[] = [
  { valor: "normal", etiqueta: "Normal", cada: "~12 min", aviso: "Ritmo normal: un mensaje cada ~12 min" },
  { valor: "rapido", etiqueta: "Rápido", cada: "~7 min", aviso: "Ritmo rápido: un mensaje cada ~7 min" },
  { valor: "turbo", etiqueta: "Turbo", cada: "6 min", aviso: "Turbo activado — acuérdate de volver a normal" },
]

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
  tipo: TipoZona
  search_name?: string | null
  coords?: [number, number][] | null
  ultima_ejecucion?: string | null
  ultimo_resultado?: number | null
  operacion?: Operacion | null
  tipo_inmueble?: TipoInmueble | null
  ventana_horas?: number | null
  prioridad?: number | null
}

interface Props {
  enabled: boolean
  zonas: Zona[]
  limiteDiario: number
  ritmo: Ritmo
  uso: ApifyUso | null
  cola: { enCola: number; enviadasHoy: number }
  avisos: { emails: string[]; telefonos: string[] }
}

function fmtHace(iso?: string | null) {
  if (!iso) return "sin datos"
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "ahora mismo"
  if (mins < 60) return `hace ${mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}

export function CaptacionesConfig({
  enabled: initialEnabled,
  zonas: initialZonas,
  limiteDiario: initialLimite,
  ritmo: initialRitmo,
  uso,
  cola,
  avisos,
  reparto,
}: Props & { reparto: EstadoAsignacion }) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [zonas, setZonas] = useState<Zona[]>(initialZonas)
  const [limite, setLimite] = useState(initialLimite)
  const [ritmo, setRitmoLocal] = useState<Ritmo>(initialRitmo)
  const [toggling, setToggling] = useState(false)
  const [loadingZona, setLoadingZona] = useState<string | null>(null)

  // View: list | create
  const [view, setView] = useState<"list" | "create">("list")
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Arrastre para reordenar zonas. Se usa el arrastre nativo del navegador en vez
  // de una librería: son cuatro filas en un panel de escritorio y no compensa
  // meter una dependencia. En táctil no funciona, pero este panel se usa desde el
  // ordenador.
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [encima, setEncima] = useState<number | null>(null)

  // Create-form state
  const [nombre, setNombre] = useState("")
  const [tipo, setTipo] = useState<TipoZona>("zona")
  const [urlPegada, setUrlPegada] = useState("")

  // Al pegar una URL, la ventana la manda LA URL, no el selector. Antes se
  // guardaba lo que marcara el selector y el scraper reescribía la URL con ese
  // valor: pegabas una de 48 h, el selector estaba en otra cosa, y la zona salía
  // pidiendo algo distinto de lo que habías comprobado en Idealista.
  function pegarUrl(v: string) {
    setUrlPegada(v)
    const m = /publicado_ultimas-(\d+)-horas/.exec(v)
    if (m) {
      const h = Number(m[1])
      if (h === 24 || h === 48) setVentanaHoras(h)
    } else if (v.trim().startsWith("https://www.idealista.com/")) {
      // Sin filtro de fecha en la URL: es un barrido.
      setVentanaHoras(0)
    }
  }
  const [operacion, setOperacion] = useState<Operacion>("venta")
  const [tipoInmueble, setTipoInmueble] = useState<TipoInmueble>("viviendas")
  const [ventanaHoras, setVentanaHoras] = useState<0 | 24 | 48>(0)
  const [polygonCoords, setPolygonCoords] = useState<[number, number][]>([])
  const [clearSignal, setClearSignal] = useState(0)
  const [saving, setSaving] = useState(false)

  const generatedUrl = useMemo(() => {
    // La sección de Idealista es "<operación>-<tipo>": venta-viviendas,
    // alquiler-locales... Y los filtros van encadenados con comas tras "con-".
    //
    // Aquí había también un filtro "de-particulares". No existe: probado contra
    // Idealista, /de-particulares/ devuelve "No results found" y dentro de /con-
    // se ignora en silencio y siguen saliendo todas las agencias. El filtrado por
    // particular lo hace el scraper con contactInfo.userType, después de Apify.
    const seccion = `${operacion}-${tipoInmueble}`
    const filtros = ventanaHoras === 0 ? "" : `publicado_ultimas-${ventanaHoras}-horas`
    // URL pegada a mano: se respeta tal cual. Es la opción que cubre cualquier
    // búsqueda que Idealista sepa hacer y el formulario no.
    if (tipo === "url") return urlPegada.trim()
    if (tipo === "zona" && polygonCoords.length > 2)
      return `https://www.idealista.com/areas/${seccion}/${filtros ? `con-${filtros}/` : ""}?shape=((${encodePolyline(polygonCoords)}))&ordenado-por=fecha-publicacion-desc`
    return ""
  }, [tipo, urlPegada, polygonCoords, operacion, tipoInmueble, ventanaHoras])

  const urlValida = /^https:\/\/www\.idealista\.com\//.test(generatedUrl)
  const canSave = nombre.trim().length > 0 && generatedUrl.length > 0 && urlValida

  function goToList() {
    setView("list")
    setNombre("")
    setTipo("zona")
    setUrlPegada("")
    setOperacion("venta")
    setTipoInmueble("viviendas")
    setVentanaHoras(0)
    setPolygonCoords([])
    setClearSignal(s => s + 1)
  }

  async function handleLimite(next: number) {
    const n = Math.max(1, Math.min(80, next))
    setLimite(n)
    await setLimiteDiario(n)
  }

  async function handleRitmo(r: Ritmo) {
    const antes = ritmo
    setRitmoLocal(r)
    const res = await setRitmo(r)
    if (res.error) { setRitmoLocal(antes); toast.error(res.error); return }
    toast.success(RITMOS.find(x => x.valor === r)!.aviso)
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
    const res = await agregarZona({
      url: generatedUrl,
      nombre,
      tipo,
      search_name: null,
      coords: tipo === "zona" ? polygonCoords : null,
      operacion,
      tipo_inmueble: tipoInmueble,
      ventana_horas: ventanaHoras,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    setZonas(z => [...z, {
      id: crypto.randomUUID(),
      url: generatedUrl,
      nombre: nombre.trim(),
      activa: false,
      tipo,
      search_name: null,
      coords: tipo === "zona" ? polygonCoords : null,
      operacion,
      tipo_inmueble: tipoInmueble,
      ventana_horas: ventanaHoras,
    }])
    toast.success(res.aviso ?? "Zona añadida")
    goToList()
  }

  // Varias zonas pueden estar activas: todas viajan en el mismo run de Apify,
  // así que el arranque del actor se paga una sola vez.
  async function handleToggleZona(id: string, activa: boolean) {
    setLoadingZona(id)
    await toggleZona(id, activa)
    setZonas(z => z.map(zona => (zona.id === id ? { ...zona, activa } : zona)))
    setLoadingZona(null)
  }

  // Al soltar: se pinta el orden nuevo al momento y se guarda detrás. Si el
  // guardado falla se vuelve al orden anterior, para que la lista nunca enseñe
  // algo distinto de lo que el captador va a hacer.
  async function soltarEn(destino: number) {
    const origen = arrastrando
    setArrastrando(null)
    setEncima(null)
    if (origen === null || origen === destino) return

    const antes = zonas
    const copia = [...zonas]
    const [movida] = copia.splice(origen, 1)
    copia.splice(destino, 0, movida)
    setZonas(copia.map((z, k) => ({ ...z, prioridad: k + 1 })))

    const res = await reordenarZonas(copia.map(z => z.id))
    if (res.error) { setZonas(antes); toast.error(res.error); return }
    toast.success(`Ahora manda "${copia[0].nombre}"`)
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
    ? (!mapZona || mapZona.tipo !== "zona")
    : tipo !== "zona"

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

            {/* Ritmo de envío */}
            <section className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Ritmo de envío</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tope de mensajes al día, contando los manuales. Es lo que evita que WhatsApp bloquee el número.
                </p>
              </div>

              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/20">
                <Send className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={limite}
                  onChange={e => handleLimite(Number(e.target.value))}
                  className="flex-1 accent-violet-500"
                />
                <span className="text-sm font-semibold tabular-nums w-14 text-right">{limite}/día</span>
              </div>

              {/* Velocidad de la cola */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Velocidad de envío</label>
                <div className="grid grid-cols-3 gap-2">
                  {RITMOS.map(r => (
                    <button
                      key={r.valor}
                      onClick={() => handleRitmo(r.valor)}
                      className={cn(
                        "py-2 rounded-lg border text-sm font-medium transition-all",
                        ritmo === r.valor
                          ? r.valor === "turbo"
                            ? "border-amber-500/60 bg-amber-500/10 text-amber-500"
                            : "border-violet-500/50 bg-violet-500/10 text-violet-400"
                          : "border-border bg-muted/20 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {r.etiqueta}
                      <span className="block text-[10px] font-normal opacity-70">{r.cada}</span>
                    </button>
                  ))}
                </div>
                <p className={cn(
                  "text-[11px] leading-relaxed",
                  ritmo === "turbo" ? "text-amber-500" : "text-muted-foreground/70",
                )}>
                  {ritmo === "turbo"
                    ? "Turbo quita el salto aleatorio, así que los mensajes salen a intervalos casi idénticos — es la firma que delata un automatismo. Úsalo para vaciar una cola acumulada y vuelve a normal."
                    : "Cuánto se espera entre un mensaje y el siguiente. El hueco es irregular a propósito: la regularidad milimétrica es de lo primero que mira WhatsApp para marcar una cuenta."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Enviados hoy</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {cola.enviadasHoy}
                    <span className="text-muted-foreground font-normal"> / {limite}</span>
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> En cola
                  </p>
                  <p className="text-sm font-semibold tabular-nums">{cola.enCola}</p>
                </div>
              </div>
            </section>

            <AvisosDestinos emails={avisos.emails} telefonos={avisos.telefonos} />

            <RepartoAgentes estado={reparto} />

            {/* Presupuesto Apify */}
            <section className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Presupuesto Apify</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  El captador se autorregula: salta pasadas si el gasto se adelanta al ritmo del ciclo.
                </p>
              </div>

              {uso ? (
                <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      {uso.gastado.toFixed(2)} $
                      <span className="text-muted-foreground font-normal">de {uso.limite} $</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{uso.progreso_ciclo}% del ciclo</span>
                  </div>

                  {/* Barra: gasto real sobre el límite, con marca del ritmo esperado */}
                  <div className="relative h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        uso.seguir ? "bg-emerald-500" : "bg-orange-500",
                      )}
                      style={{ width: `${Math.min(100, (uso.gastado / uso.limite) * 100)}%` }}
                    />
                  </div>

                  <p className={cn("text-xs", uso.seguir ? "text-muted-foreground" : "text-orange-500 font-medium")}>
                    {uso.seguir
                      ? `Dentro de ritmo · actualizado ${fmtHace(uso.actualizado)}`
                      : `Pausado: ${uso.motivo}`}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                  Sin datos todavía. Se rellena en la primera pasada del captador.
                </div>
              )}
            </section>

            {/* Zonas */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Zonas de scraping</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Puedes activar varias: van todas en el mismo run y el arranque se paga una vez.
                  </p>
                </div>
                <button
                  onClick={() => setView("create")}
                  className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Añadir
                </button>
              </div>

              {zonas.length > 1 && (
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed pb-1">
                  Arrastra para cambiar el orden. La primera se lleva el doble de pasadas que la
                  segunda, ésta el doble que la tercera, y así — ninguna se queda sin atender.
                </p>
              )}

              <div className="space-y-2">
                {zonas.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    <Globe className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    No hay zonas configuradas
                  </div>
                )}
                {zonas.map((zona, i) => (
                  <div
                    key={zona.id}
                    draggable
                    onDragStart={() => setArrastrando(i)}
                    onDragEnd={() => { setArrastrando(null); setEncima(null) }}
                    onDragOver={e => { e.preventDefault(); setEncima(i) }}
                    onDrop={e => { e.preventDefault(); soltarEn(i) }}
                    onMouseEnter={() => setHoveredId(zona.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                      zona.activa ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20",
                      arrastrando === i && "opacity-40",
                      encima === i && arrastrando !== null && arrastrando !== i && "border-violet-500 border-dashed",
                    )}
                  >
                    <div
                      className="flex items-center gap-1 shrink-0 pt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground"
                      title="Arrastra para cambiar el orden de atención"
                    >
                      <GripVertical className="h-4 w-4" />
                      <span className="text-[10px] font-bold w-3 text-center">{i + 1}</span>
                    </div>
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
                      {/* Qué busca esta zona. Con varias activas a la vez, el nombre
                          solo ("Valencia") no basta para saber cuál es cuál. */}
                      <div className="flex flex-wrap items-center gap-1 pb-0.5">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                          zona.operacion === "alquiler" ? "bg-amber-500/15 text-amber-400" : "bg-sky-500/15 text-sky-400",
                        )}>
                          {(zona.operacion ?? "venta").toUpperCase()}
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                          {TIPOS_INMUEBLE.find(t => t.valor === (zona.tipo_inmueble ?? "viviendas"))?.etiqueta ?? "Viviendas"}
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                          {zona.ventana_horas ?? 24} h
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{zona.url}</p>
                      {zona.activa && (
                        <p className="text-[11px] text-muted-foreground/70 pt-0.5">
                          Última pasada {fmtHace(zona.ultima_ejecucion)}
                          {typeof zona.ultimo_resultado === "number" && ` · ${zona.ultimo_resultado} particulares`}
                        </p>
                      )}
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

            {/* Info técnica
                Aquí se enseñaba la URL de /api/webhook/captacion-respuesta como si
                fuera el sitio donde configurar las respuestas de WhatsApp. Ese
                endpoint era un segundo clasificador, por palabras clave, que
                duplicaba el de IA y que no llamaba nadie: ni n8n ni el CRM. Su
                propio comentario admitía que estuvo roto meses sin que se notara,
                porque escribía un estado que ya no existía y no miraba el error.
                Borrado. Las respuestas las clasifica el workflow
                "5 · Captador — Clasificar Respuestas WhatsApp" de n8n, que es
                quien recibe de Evolution a través del dispatcher. */}
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
                {/* Antes había una tercera opción, "Por nombre", que montaba una URL
                    del tipo /buscar/…?q=Ruzafa. Se ha quitado porque no funciona: el
                    scraper devuelve "No results found" con esa forma de URL, con
                    ventana y sin ella, mientras el mismo barrio por polígono sí capta.
                    Pegar la URL cubre ese caso y cualquier otro. */}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { valor: "zona" as const, icono: <MapIcon className="h-4 w-4" />, etiqueta: "Por polígono" },
                    { valor: "url" as const, icono: <Globe className="h-4 w-4" />, etiqueta: "Pegar URL" },
                  ]).map(t => (
                    <button
                      key={t.valor}
                      onClick={() => { setTipo(t.valor); setPolygonCoords([]); setClearSignal(s => s + 1) }}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all",
                        tipo === t.valor
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                          : "border-border bg-muted/20 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t.icono}
                      {t.etiqueta}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type-specific input */}
              {tipo === "url" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">URL de Idealista</label>
                  <textarea
                    value={urlPegada}
                    onChange={e => pegarUrl(e.target.value)}
                    rows={3}
                    placeholder="https://www.idealista.com/venta-locales/valencia/valencia/con-publicado_ultimas-48-horas/"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Busca en Idealista como quieras y pega aquí la URL de resultados. Se guarda
                    tal cual, así que comprueba antes que muestra anuncios.
                  </p>
                  {urlPegada.trim() && !urlValida && (
                    <p className="text-[11px] text-amber-500 leading-relaxed">
                      Tiene que empezar por https://www.idealista.com/
                    </p>
                  )}
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

              {/* Operación */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Operación</label>
                <div className="grid grid-cols-2 gap-2">
                  {OPERACIONES.map(o => (
                    <button
                      key={o.valor}
                      onClick={() => {
                        setOperacion(o.valor)
                        // En alquiler la ventana de 48 h no existe en Idealista.
                        if (o.valor === "alquiler" && ventanaHoras === 48) setVentanaHoras(24)
                      }}
                      className={cn(
                        "py-2 rounded-lg border text-sm font-medium transition-all",
                        operacion === o.valor
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                          : "border-border bg-muted/20 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {o.etiqueta}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  Cambia el mensaje entero: en alquiler se ofrecen inquilinos solventes con seguro
                  de impago; en venta, compradores para cerrar la operación.
                </p>
              </div>

              {/* Tipo de inmueble */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tipo de inmueble</label>
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS_INMUEBLE.map(t => (
                    <button
                      key={t.valor}
                      onClick={() => setTipoInmueble(t.valor)}
                      className={cn(
                        "py-2 rounded-lg border text-xs font-medium transition-all",
                        tipoInmueble === t.valor
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                          : "border-border bg-muted/20 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.etiqueta}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  El mensaje habla de &quot;su {TIPOS_INMUEBLE.find(t => t.valor === tipoInmueble)?.enMensaje}&quot;
                  y sólo menciona lo que ese tipo tiene.
                </p>
              </div>

              {/* Ventana */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Qué anuncios mira</label>
                <div className="grid grid-cols-3 gap-2">
                  {([0, 24, 48] as const).map(h => {
                    // Idealista no tiene la ventana de 48 h en la sección de
                    // alquiler: probado dos veces, /alquiler-viviendas/…/con-
                    // publicado_ultimas-48-horas/ devuelve cero mientras la de
                    // 24 h del mismo día devuelve anuncios. Ofrecerla sería
                    // crear una zona muda.
                    const noDisponible = operacion === "alquiler" && h === 48
                    return (
                      <button
                        key={h}
                        disabled={noDisponible}
                        onClick={() => setVentanaHoras(h)}
                        className={cn(
                          "py-2 rounded-lg border text-sm font-medium transition-all",
                          noDisponible
                            ? "border-border bg-muted/10 text-muted-foreground/40 cursor-not-allowed"
                            : ventanaHoras === h
                              ? "border-violet-500/50 bg-violet-500/10 text-violet-400"
                              : "border-border bg-muted/20 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {h === 0 ? "Barrido" : `${h} h`}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  {ventanaHoras === 0
                    ? "Sin filtro de fecha: recorre el catálogo entero poco a poco, descartando lo que ya captó. Lo recién publicado entra primero. Es lo que más capta, y el gasto lo va frenando el guardarraíl de presupuesto."
                    : operacion === "alquiler"
                      ? "En alquiler Idealista no ofrece la ventana de 48 h: esa URL devuelve cero anuncios."
                      : tipoInmueble === "viviendas"
                        ? "Sólo lo publicado en esa ventana. En vivienda 24 h da de sobra, pero se queda muy corto frente al barrido."
                        : "Mercado fino: en locales salieron 13 anuncios en 48 h y ninguno en 24 h."}
                </p>
                {ventanaHoras === 0 && tipo === "url" && (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
                    Si tu URL lleva <code className="text-[10px]">ordenado-por=fecha-publicacion-asc</code>, el
                    barrido empieza por los <strong>más antiguos</strong> — los propietarios que llevan meses
                    sin vender. Sin ese parámetro empieza por los más recientes.
                  </p>
                )}
              </div>

              {/* Por qué ya no hay filtro de particulares */}
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground p-3 rounded-lg border border-border bg-muted/10 leading-relaxed">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Idealista ya no deja filtrar por particular desde la URL (probado: lo ignora y
                  siguen saliendo agencias). El captador los descarta después, al normalizar.
                </span>
              </div>

              {/* URL preview */}
              {generatedUrl ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">URL generada</label>
                    <a
                      href={generatedUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-400 font-medium shrink-0"
                    >
                      Comprobar <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[10px] font-mono text-muted-foreground break-all leading-relaxed">
                    {generatedUrl}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Ábrela antes de guardar: si Idealista muestra resultados, el captador los verá.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-lg border border-border bg-muted/10">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{tipo === "url" ? "Pega la URL de resultados de Idealista" : "Dibuja un polígono en el mapa para generar la URL"}</span>
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
