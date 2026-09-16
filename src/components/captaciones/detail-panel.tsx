"use client"

import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import Link from "next/link"
import { X, MapPin, Home, TrendingDown, TrendingUp, ExternalLink, StickyNote, Info, Loader2, Trash2, MessageCircle, PhoneOff, Sparkles, Send, Building2, ArrowUpRight, RotateCcw } from "lucide-react"
import { AgendaPanel } from "./agenda-panel"
import { getCaptacion, getHistorial, getAgentes, eliminarCaptacion, contactarCaptacion, contactarCaptacionConTelefono, generarMensajeIA, reintentarAutoContacto } from "@/lib/actions/captaciones"
import { promocionarCaptacion } from "@/lib/actions/prospectos"
import { getMensajesCaptacion, type Mensaje } from "@/lib/actions/mensajes"
import { getInteracciones, type Interaccion } from "@/lib/actions/interacciones"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { createClient } from "@/lib/supabase/client"
import { Skeleton } from "@/components/ui/skeleton"
import { Atendido } from "@/components/shared/atendido"
import { LineaTiempo, type PersonaLinea } from "@/components/shared/linea-tiempo"
import { claseColor, clasePunto, colorDe, nombreDe, type Catalogo } from "@/lib/catalogos"
import { WA_REINTENTABLES } from "@/types/captaciones"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type Tab = "notas" | "info"

/** Lo que Idealista escribe cuando no sabe el estado del piso: no se enseña. */
const ESTADOS_OCULTOS = ["sin identificar", "no especificado", "sin especificar", "desconocido"]

/**
 * Las tres listas del catálogo que se pintan en esta ficha.
 *
 * `estado_whatsapp` responde a "¿ha contestado?", `senal_interes` a "¿qué ha
 * entendido la IA?" y `estado_lead` a "¿por dónde va el trato?". Son tres
 * preguntas distintas y por eso son tres columnas: hasta la migración 027,
 * `Interesado` y `Quiere_Llamada` eran estados de WhatsApp y respondían a las
 * tres a la vez.
 *
 * `estado_crm` se nombra con el catálogo `estado_lead` y no con uno propio: son
 * los mismos siete valores del pipeline de leads, y de ahí los saca ya el
 * tablero (`captaciones-pipeline.tsx`). Escritos a mano aquí, "Negociacion"
 * salía sin tilde y un valor recoloreado desde /configuracion/catalogos nunca
 * llegaba a esta ficha.
 */
const WA_CAT = "estado_whatsapp"
const SENAL_CAT = "senal_interes"
const CRM_CAT = "estado_lead"

/**
 * Qué catálogo nombra cada columna del historial de cambios.
 *
 * El historial guarda el valor crudo que escribió el workflow
 * ("Quiere_Llamada", "Negociacion"), así que sin esto una fila de hace tres
 * meses se lee en bruto. `nombreDe` cae al valor crudo cuando no está
 * catalogado, que es exactamente lo que hace falta con los dos valores que la
 * 027 archivó: las 95 filas que los nombran se siguen leyendo.
 *
 * `estado` no está en el mapa a propósito: es el texto libre que manda
 * Idealista ("buen estado", "a reformar"), no una lista nuestra.
 */
const CAT_POR_CAMPO: Record<string, string> = {
  estado_crm: CRM_CAT,
  estado_whatsapp: WA_CAT,
  senal: SENAL_CAT,
}

/**
 * Las fechas se formatean con locale y zona fijos.
 *
 * El servidor corre en UTC y el navegador en Madrid: si cada uno usara la suya,
 * el mismo dato saldría con una hora distinta a cada lado y React lo cantaría
 * como desajuste al hidratar. Numérico y no "14 sept" por lo mismo: el ICU de
 * Node y el del navegador no siempre abrevian igual los meses.
 */
const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Madrid",
})
const FECHA_HORA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
})

/**
 * El reloj, tratado como lo que es: un sistema externo a React.
 *
 * Mismo planteamiento que en `shared/linea-tiempo.tsx`, y por el mismo motivo:
 * "hace 2 días" sale de Date.now(), así que calculado durante el render el HTML
 * del servidor y el del primer render del cliente dirían cosas distintas y
 * React lo cantaría como desajuste de hidratación. Leído con
 * useSyncExternalStore, los dos ven null y enseñan la fecha absoluta —idéntica
 * a ambos lados—; ya hidratado, React repinta con la hora de verdad.
 *
 * Está copiado y no importado porque en linea-tiempo es privado del módulo.
 * Cuando haya un sitio común para el tiempo, este trozo se va allí.
 */
const RELOJ = {
  subscribe(alCambiar: () => void) {
    // Cada minuto, para que la señal no envejezca a la vista de quien deja la
    // ficha abierta mientras llama.
    const t = setInterval(alCambiar, 60_000)
    return () => clearInterval(t)
  },
  // Redondeado al minuto a propósito: getSnapshot tiene que devolver lo mismo
  // mientras nada cambie, y un Date.now() crudo renderizaría sin parar.
  ahora: () => Math.floor(Date.now() / 60_000) * 60_000,
  enServidor: () => null,
}

/** Días naturales, no bloques de 24 h: a las 00:30 "ayer" tiene que ser ayer. */
function diasNaturales(antes: number, ahora: number): number {
  const a = new Date(antes)
  const b = new Date(ahora)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Pasada una semana, "hace N días" ya no sitúa a nadie: mejor la fecha. */
function cuando(ms: number, ahora: number): string {
  const seg = Math.round((ahora - ms) / 1000)
  // El reloj va redondeado al minuto, así que una señal recién detectada puede
  // caer unos segundos "en el futuro". Sólo lo futuro de verdad lleva fecha.
  if (seg < -120) return FECHA.format(ms)
  if (seg < 60) return "ahora mismo"
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = diasNaturales(ms, ahora)
  if (dias <= 1) return "ayer"
  if (dias < 7) return `hace ${dias} días`
  return FECHA.format(ms)
}

/** El sello de la señal, si lo hay y se puede leer. Una fecha rota no pinta. */
function msDe(ts: unknown): number | null {
  if (typeof ts !== "string") return null
  const ms = new Date(ts).getTime()
  return Number.isNaN(ms) ? null : ms
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

function WhatsAppPanel({ captacion, catalogos, onUpdate }: { captacion: any; catalogos: Catalogo[]; onUpdate: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [cargando, setCargando] = useState(false)
  const [mensaje, setMensaje] = useState("")
  const [generando, setGenerando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [reintentando, setReintentando] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const tienePhone = hasPhone(captacion.telefono)
  const estadoWA = captacion.estado_whatsapp as string | null

  // Estado para captaciones sin teléfono
  const [telefonoManual, setTelefonoManual] = useState("")
  const [faseNoTel, setFaseNoTel] = useState<"input" | "mensaje">("input")

  async function cargarMensajes() {
    if (!tienePhone) return
    setCargando(true)
    // `.catch` y no sólo un `finally`: si la acción ni llega a contestar —red
    // caída, despliegue a mitad— el `await` lanza, el `setCargando(false)` de
    // abajo no se ejecuta nunca y el panel se queda girando para siempre sin
    // decir por qué. Vale para todos los botones de este panel.
    const data = await getMensajesCaptacion(captacion.telefono).catch(() => null)
    setCargando(false)
    if (!data) {
      toast.error("No se pudo cargar la conversación")
      return
    }
    setMensajes(data)
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 50)
  }

  useEffect(() => { if (tienePhone) cargarMensajes() }, [captacion.id])

  async function handleGenerar() {
    setGenerando(true)
    // Un mensaje vacío también es un fallo: la acción devuelve "" cuando no
    // encuentra la captación, y abrir el editor en blanco parece que ha ido
    // bien.
    const msg = await generarMensajeIA(captacion.id).catch(() => "")
    setGenerando(false)
    if (!msg) { toast.error("No se pudo generar el mensaje"); return }
    setMensaje(msg)
    setExpandido(true)
  }

  async function handleGenerarNoTel() {
    setGenerando(true)
    const msg = await generarMensajeIA(captacion.id).catch(() => "")
    setGenerando(false)
    if (!msg) { toast.error("No se pudo generar el mensaje"); return }
    setMensaje(msg)
    setFaseNoTel("mensaje")
  }

  async function handleEnviar() {
    if (!mensaje.trim()) return
    setEnviando(true)
    const res = await contactarCaptacion(captacion.id, mensaje)
      .catch(() => ({ error: "No se pudo enviar el mensaje" }))
    setEnviando(false)
    if (res.error) { toast.error(res.error); return }
    toast.success("Mensaje enviado por WhatsApp")
    onUpdate()
    void cargarMensajes()
  }

  async function handleEnviarNoTel() {
    if (!mensaje.trim() || !telefonoManual.trim()) return
    setEnviando(true)
    const res = await contactarCaptacionConTelefono(captacion.id, telefonoManual, mensaje)
      .catch(() => ({ error: "No se pudo enviar el mensaje" }))
    setEnviando(false)
    if (res.error) { toast.error(res.error); return }
    toast.success("Mensaje enviado por WhatsApp")
    onUpdate()
  }

  // Estados desde los que el captador ya no reintenta por su cuenta:
  //  · Sin_WhatsApp / Duplicado → terminales, pero el agente puede querer forzarlo.
  //  · reserva puesta y sin estado → el envío se quedó a medias (Evolution no
  //    confirmó). Se deja fuera de la cola a propósito para no duplicar el mensaje,
  //    así que reactivarlo tiene que ser una decisión humana.
  const intentoAMedias = !estadoWA && !!captacion.contacto_lock_en
  const puedeReintentar = (!!estadoWA && WA_REINTENTABLES.includes(estadoWA)) || intentoAMedias

  async function handleReintentar() {
    setReintentando(true)
    const res = await reintentarAutoContacto(captacion.id)
      .catch(() => ({ error: "No se pudo devolver a la cola" }))
    setReintentando(false)
    if (res?.error) { toast.error(res.error); return }
    toast.success("Vuelve a la cola del captador")
    onUpdate()
  }

  // Agrupar mensajes por día
  const porDia: { dia: string; items: Mensaje[] }[] = []
  for (const m of mensajes) {
    const dia = fmtDia(m.timestamp)
    const last = porDia[porDia.length - 1]
    if (last?.dia === dia) last.items.push(m)
    else porDia.push({ dia, items: [m] })
  }

  return (
    // Sin margen propio: el hueco con lo que tiene al lado lo pone el `gap` del
    // contenedor de la pestaña, que es quien sabe qué hay pintado y qué no.
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
        <MessageCircle className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex-1">WhatsApp</span>
        {!tienePhone && faseNoTel === "input" && (
          <span className="flex items-center gap-1 text-xs text-amber-500 font-medium">
            <PhoneOff className="h-3 w-3" /> Sin teléfono
          </span>
        )}
        {tienePhone && !estadoWA && (
          <span className="text-xs text-muted-foreground">{captacion.telefono}</span>
        )}
        {/* El estado de la conversación, también desde el catálogo. Aquí sí es
            la pastilla entera: va sobre el fondo del panel, no sobre la foto.
            Se quitó el "Enviado · sin respuesta" escrito a mano; el matiz lo
            da ya el propio catálogo, que es donde se puede cambiar. */}
        {estadoWA && (
          <span className={cn(
            "flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium",
            claseColor(colorDe(catalogos, WA_CAT, estadoWA)),
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(colorDe(catalogos, WA_CAT, estadoWA)))} />
            {nombreDe(catalogos, WA_CAT, estadoWA)}
          </span>
        )}
        {puedeReintentar && (
          <button
            onClick={handleReintentar}
            disabled={reintentando}
            title={intentoAMedias
              ? "El envío anterior no se confirmó. Devolver a la cola del captador."
              : "Devolver a la cola del captador automático"}
            className="flex items-center gap-1 text-xs font-medium text-violet-500 hover:text-violet-400 transition-colors disabled:opacity-50"
          >
            {reintentando
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RotateCcw className="h-3 w-3" />}
            {intentoAMedias ? "Envío sin confirmar · reintentar" : "Reintentar"}
          </button>
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
              : <Send className="h-3 w-3" />}
          </button>
        )}
      </div>

      {!tienePhone && (
        <div className="p-4 space-y-3">
          {faseNoTel === "input" && (
            <>
              <p className="text-xs text-muted-foreground">Introduce el teléfono del propietario para enviarle un mensaje:</p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  placeholder="6XX XXX XXX"
                  value={telefonoManual}
                  onChange={(e) => setTelefonoManual(e.target.value)}
                  className="flex-1 h-8 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={handleGenerarNoTel}
                  disabled={generando || telefonoManual.replace(/[^\d]/g, "").length < 9}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-40 transition-colors"
                >
                  {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Generar mensaje
                </button>
              </div>
            </>
          )}
          {faseNoTel === "mensaje" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Para: <span className="text-foreground font-medium">{telefonoManual}</span></p>
                <button onClick={() => setFaseNoTel("input")} className="text-xs text-muted-foreground hover:text-foreground">Cambiar</button>
              </div>
              <textarea
                rows={7}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleGenerarNoTel}
                  disabled={generando}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border"
                >
                  <Sparkles className="h-3 w-3" /> Regenerar
                </button>
                <button
                  onClick={handleEnviarNoTel}
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

/**
 * A dónde lleva "Ver prospecto".
 *
 * Parámetro y no `/prospectos/<id>`: /prospectos es hoy una sola página y la
 * ficha la está montando otro agente. Con `?p=` el enlace ya funciona —cae en
 * la pantalla de prospectos— y el día que haya ficha sólo tiene que leer el
 * parámetro; una ruta anidada que todavía no existe sería un 404 desde el
 * primer clic.
 */
const rutaProspecto = (id: string) => `/prospectos?p=${id}`

interface Props {
  captacionId: number | null
  onClose: () => void
  isAdmin?: boolean
  hideWhatsApp?: boolean
  /**
   * Aviso al padre de que ESTA captación ha cambiado y la tarjeta que la
   * representa en la lista ya no dice la verdad.
   *
   * Hasta ahora sólo se recargaba al cerrar el panel (`onClose`), así que
   * traspasar el agente desde aquí dejaba la tarjeta de la izquierda enseñando
   * el agente viejo mientras el panel seguía abierto — y el traspaso parecía no
   * haberse guardado. Se dispara al traspasar, al atender, al contactar por
   * WhatsApp y al pasar a prospecto: las cuatro cosas que se ven desde fuera.
   *
   * Es opcional a propósito: quien renderice el panel decide si su lista se
   * puede refrescar sin perder el sitio. Está sin enganchar en
   * `captaciones-list.tsx` y en `mensajes-shell.tsx`, que son de otro agente.
   */
  onCambio?: () => void
}

function fmt(n: number | null) {
  if (!n) return "—"
  return n.toLocaleString("es-ES") + " €"
}

export function DetailPanel({ captacionId, onClose, isAdmin = true, hideWhatsApp = false, onCambio }: Props) {
  const [tab, setTab] = useState<Tab>("notas")
  const [data, setData] = useState<Awaited<ReturnType<typeof getCaptacion>> | null>(null)
  const [historial, setHistorial] = useState<Awaited<ReturnType<typeof getHistorial>>>([])
  const [agentes, setAgentes] = useState<Awaited<ReturnType<typeof getAgentes>>>([])
  const [interacciones, setInteracciones] = useState<Interaccion[]>([])
  const [loading, setLoading] = useState(false)
  const [fallo, setFallo] = useState(false)
  const [promocionando, setPromocionando] = useState(false)
  /**
   * Los dos avisos de "esto no se deshace", como diálogo propio y no como
   *  del navegador.
   *
   * El  nativo lo CANCELAN SOLOS los navegadores incrustados (el
   * panel de vista previa, una webview, un móvil con los diálogos bloqueados).
   * El botón parecía roto: se pulsaba y no pasaba nada, ni aviso ni error.
   */
  const [confirmProspecto, setConfirmProspecto] = useState(false)
  const [confirmBaja, setConfirmBaja] = useState(false)
  const [dandoDeBaja, setDandoDeBaja] = useState(false)
  /**
   * El prospecto recién creado, sólo hasta que `load()` traiga la fila con su
   * `prospecto_id`. Sin esto, entre el "hecho" y la relectura el botón volvería
   * a ofrecer promocionar algo que ya está promocionado.
   */
  const [prospectoNuevo, setProspectoNuevo] = useState<string | null>(null)

  // Ni los catálogos ni quién soy dependen de la captación abierta, así que no
  // viajan en `load()`: se piden una vez y se quedan mientras el panel viva.
  const [catalogos, setCatalogos] = useState<Catalogo[]>([])
  const [yoId, setYoId] = useState("")

  // null hasta que el componente está hidratado; ver RELOJ. Con null se enseña
  // la fecha absoluta, que es igual en el servidor y en el navegador.
  const ahora = useSyncExternalStore<number | null>(
    RELOJ.subscribe,
    RELOJ.ahora,
    RELOJ.enServidor,
  )

  /**
   * Al abrir otra captación, la ficha vuelve a su sitio.
   *
   * El panel no se desmonta entre una y otra —está siempre montado y sólo se
   * desliza—, así que sin esto la siguiente se abriría en la pestaña de la
   * anterior y con su historial debajo mientras carga el suyo. Se hace durante
   * el render y no en un efecto: así no hay un repintado intermedio con los
   * datos mezclados, y el lint del compilador tampoco lo permitiría.
   */
  const [vista, setVista] = useState<number | null>(null)
  if (captacionId !== vista) {
    setVista(captacionId)
    setTab("notas")
    setProspectoNuevo(null)
    // El salto de la ficha anterior puede seguir en el aire: sin apagarlo aquí,
    // la captación que se acaba de abrir enseña su botón en "Pasando a
    // prospecto…" y deshabilitado por un salto que no es el suyo.
    setPromocionando(false)
    setInteracciones([])
    setFallo(false)
    // El esqueleto se enciende aquí y no dentro del efecto por dos motivos: el
    // primer pintado de la ficha nueva ya no enseña un fotograma con los datos
    // de la anterior, y el lint del compilador no admite setState síncrono
    // dentro de un efecto. Al cerrar (null) se apaga: el panel se va deslizando
    // y tiene que irse con su contenido, no convertido en un esqueleto.
    setLoading(!!captacionId)
  }

  /**
   * Qué ficha se está mirando AHORA.
   *
   * `load` y los manejadores se quedan con el `captacionId` del render en el que
   * nacieron, y hay acciones que tardan —el salto a prospecto crea el contacto,
   * copia la ficha y deja rastro—: si mientras tanto se abre otra captación o se
   * cierra el panel, la relectura de la anterior pintaba sus datos encima de la
   * que se está mirando, y entonces "Atendido" apuntaba la llamada en la ficha
   * equivocada. La referencia se lee al contestar, no al pulsar, así que no
   * envejece con el manejador.
   */
  const idVisible = useRef(captacionId)
  useEffect(() => { idVisible.current = captacionId }, [captacionId])

  /**
   * Lee la ficha entera.
   *
   * `otraFicha` separa las dos veces que se llama a esto, que sólo se
   * diferencian al fallar: abriendo OTRA captación no puede quedarse en
   * pantalla la anterior —el botón de atender apuntaría la llamada en la
   * captación equivocada—, mientras que releyendo tras guardar una nota lo que
   * ya hay sigue siendo de esta misma captación y se deja.
   *
   * `vigente` corta la respuesta que llega tarde: al bajar por la lista se
   * abren dos fichas seguidas, y si la primera contesta después de la segunda
   * pintaría sus datos encima de los de la que se está mirando. Sin decir nada
   * vale lo que siga en pantalla (`idVisible`): así también está cubierta la
   * relectura que dispara una acción lenta —atender, traspasar, promocionar—
   * cuando ya se ha cambiado de ficha o se ha cerrado el panel.
   */
  async function load({ otraFicha = false, vigente }: {
    otraFicha?: boolean
    vigente?: () => boolean
  } = {}) {
    const id = captacionId
    if (!id) return
    const sigueValiendo = vigente ?? (() => idVisible.current === id)
    try {
      const [cap, hist, ags, linea] = await Promise.all([
        getCaptacion(id),
        getHistorial(id),
        getAgentes(),
        getInteracciones({ captacionId: id }),
      ])
      if (!sigueValiendo()) return
      setData(cap)
      setHistorial(hist)
      setAgentes(ags)
      setFallo(false)
      // El historial no se traga su error: una lista vacía por un fallo de
      // lectura se ve igual que una captación sin llamadas, y eso se cree.
      if (linea.error) toast.error(linea.error)
      setInteracciones(linea.interacciones)
    } catch {
      if (!sigueValiendo()) return
      toast.error("No se pudo cargar la captación")
      if (otraFicha) {
        setData(null)
        setHistorial([])
        setInteracciones([])
        setFallo(true)
      }
    } finally {
      if (sigueValiendo()) setLoading(false)
    }
  }

  useEffect(() => {
    if (!captacionId) return
    let vivo = true
    void load({ otraFicha: true, vigente: () => vivo })
    return () => { vivo = false }
  }, [captacionId])

  useEffect(() => {
    let vivo = true

    ;(async () => {
      try {
        const cats = await getCatalogosActivos()
        if (vivo) setCatalogos(cats)
      } catch {
        // Sin catálogos, el botón de atender se queda sin los resultados de la
        // llamada. Se avisa: en silencio parecería que no hay ninguno.
        if (vivo) toast.error("No se pudieron cargar los catálogos")
      }

      // Quién soy sale de la sesión del navegador porque este panel cuelga de un
      // árbol de cliente: la línea de tiempo lo necesita para saber qué
      // anotaciones puedo borrar.
      //
      // Éste sí falla callado, y es lo correcto: sin saber quién soy la línea de
      // tiempo se sigue leyendo entera, sólo deja de ofrecer el botón de borrar.
      // Un aviso aquí sería ruido sobre algo que no impide trabajar.
      try {
        const { data: { user } } = await createClient().auth.getUser()
        if (vivo && user) setYoId(user.id)
      } catch {}
    })()

    return () => { vivo = false }
  }, [])

  // El equipo ya viene en `agentes`: la línea de tiempo sólo necesita el nombre
  // para firmar cada anotación, así que se deriva en vez de volver a pedirlo.
  const personas: PersonaLinea[] = useMemo(
    () => (agentes as Array<{ id: string; nombre: string | null; apellidos: string | null }>)
      .map((a) => ({ id: a.id, nombre: `${a.nombre ?? ""} ${a.apellidos ?? ""}`.trim() || "—" })),
    [agentes],
  )

  // El sello de la última vez que una PERSONA la atendió. `atendido_por` es un
  // uuid y el botón sólo lo enseña, así que aquí se cambia por el nombre.
  const yaAtendido = useMemo(() => {
    const en = data?.atendido_en as string | null | undefined
    if (!en) return null
    const quien = personas.find((p) => p.id === data?.atendido_por)
    return { en, por: quien?.nombre ?? null }
  }, [data, personas])

  /**
   * El prospecto de esta captación, si lo hay.
   *
   * Se mira primero lo que acaba de devolver la promoción y después la fila:
   * `load()` tarda un viaje en traer el `prospecto_id` recién escrito, y en ese
   * hueco el botón no puede volver a ofrecer el salto.
   */
  const prospectoId = prospectoNuevo
    ?? (data as { prospecto_id?: string | null } | null)?.prospecto_id
    ?? null

  /**
   * El salto: de anuncio de Idealista a piso que estamos captando.
   *
   * Todo el trabajo vive en la función SQL `promocionar_captacion` (022), que es
   * idempotente por índice único: dos clics seguidos devuelven el mismo
   * prospecto en vez de crear dos del mismo piso.
   */
  /**
   * Dar de baja: a la papelera.
   *
   * Estaba escrito dentro del `onClick` de la papelera, con su `confirm()`
   * delante. Sale aquí porque ahora lo dispara el diálogo, y porque un botón que
   * llama a la base tiene que poder apagarse mientras espera: sin eso, dos clics
   * seguidos mandaban dos bajas y la segunda cerraba el panel sobre una ficha ya
   * cerrada.
   */
  async function handleDarDeBaja() {
    if (!data || dandoDeBaja) return
    setDandoDeBaja(true)
    // Sin el .catch, una baja que no llega a contestar cerraba el panel en
    // silencio y la captación seguía viva.
    const res = await eliminarCaptacion(data.id)
      .catch(() => ({ error: "No se pudo dar de baja la captación" }))
    setDandoDeBaja(false)
    if (res.error) { toast.error(res.error); return }
    setConfirmBaja(false)
    toast.success("Captación dada de baja")
    onCambio?.()
    onClose()
  }

  async function handlePasarAProspecto() {
    if (!data) return
    // La captación sobre la que se pulsa, para poder comprobar al volver que
    // sigue siendo la que se está mirando: el salto tarda y da tiempo a abrir
    // otra ficha.
    const id = data.id

    // El aviso YA SE HA DADO, en el diálogo de abajo. Aquí sólo se cierra.
    //
    // Antes esto era un `confirm()` del navegador, y ahí estaba el fallo que
    // reportó el dueño como "el botón de pasar a prospecto no funciona": los
    // navegadores incrustados —el panel de vista previa, una webview, un móvil
    // con los diálogos bloqueados— CANCELAN SOLOS los `confirm()`. La función
    // devolvía false, el `return` se llevaba por delante la promoción y en
    // pantalla no pasaba absolutamente nada: ni aviso, ni error, ni prospecto.
    // Comprobado en la base: de todos sus intentos no se creó ni uno.
    //
    // El diálogo propio funciona en todas partes y además se lee: dice que el
    // salto copia la ficha, congela quién la captó y que desde aquí no se
    // deshace. Se avisa antes, no después.
    setConfirmProspecto(false)
    setPromocionando(true)
    // El .catch cubre que la acción ni llegue a contestar —red caída, despliegue
    // a mitad—: sin él la promesa se rompe y el botón se queda girando para
    // siempre, sin decir nada y sin dejar volver a intentarlo.
    const res: Awaited<ReturnType<typeof promocionarCaptacion>> =
      await promocionarCaptacion(id)
        .catch(() => ({ error: "No se pudo pasar a prospecto" }))

    // Si ya se está mirando otra ficha, esta respuesta no puede tocar la
    // pantalla: el aviso sí se da —el salto ha ocurrido de verdad—, pero el
    // enlace "Ver prospecto" y el botón son de la captación que se pulsó, no de
    // la que hay delante. Al volver a abrirla, `load()` trae su `prospecto_id`.
    const enPantalla = idVisible.current === id
    if (enPantalla) setPromocionando(false)

    // Los mensajes de la función SQL están escritos para leerse ("Esta captación
    // no tiene un teléfono válido. Añádelo antes de promocionar."): se enseñan
    // tal cual. Un genérico dejaría al agente sin saber qué le falta.
    if (res.error) { toast.error(res.error); return }

    // `yaExistia` NO es un fallo: alguien la promocionó antes. Se dice como lo
    // que es y se deja el enlace para ir a la ficha que ya hay.
    toast.success(res.yaExistia ? "Ya era un prospecto" : "Captación pasada a prospecto")
    if (res.prospectoId && enPantalla) setProspectoNuevo(res.prospectoId)

    // La función deja rastro en la línea de tiempo y marca la captación, así que
    // hay que releer la ficha —sólo si sigue delante; si no, al abrirla se lee
    // sola—. La tarjeta de la lista, en cambio, se avisa siempre: sigue
    // enseñando una captación sin prospecto se mire lo que se mire.
    if (enPantalla) void load()
    onCambio?.()
  }

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
                    onClick={() => setConfirmBaja(true)}
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

              {/* Info sobre imagen. Dos huecos distintos, dos contenedores: la
                  dirección y el barrio van pegados (gap-0.5) y las chapas se
                  separan del bloque (gap-2). Ningún hijo lleva margen propio. */}
              <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <p className="text-white font-semibold text-base leading-tight truncate">
                    {data.calle ?? "Sin dirección"}
                  </p>
                  {data.barrio && (
                    <span className="text-white/70 text-xs flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {data.barrio}
                    </span>
                  )}
                </div>
                {/* Los 3 estados — fila separada, etiquetados */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Estado inmueble (Idealista, read-only) */}
                  {data.estado && !ESTADOS_OCULTOS.includes(data.estado.toLowerCase().trim()) && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/50 text-white/60 border border-white/10">
                      <Home className="h-2.5 w-2.5" /> {data.estado}
                    </span>
                  )}
                  {/* Estado CRM (gestión del agente).
                      También del catálogo, por el mismo motivo que el de
                      WhatsApp: el mapa que había aquí escrito a mano pintaba
                      "Negociacion" sin tilde y se quedaba ciego a cualquier
                      recoloreado del panel. Mismo tratamiento sobre la foto:
                      el color va en el punto y el texto en blanco, porque los
                      tonos de claseColor están pensados para el fondo del panel
                      y sobre una imagen oscura se pierden. */}
                  {(() => {
                    const { estado_crm: estadoCrm } = data as { estado_crm?: string | null }
                    if (!estadoCrm) return null
                    return (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-black/50 text-white/80 border border-white/10">
                        <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(colorDe(catalogos, CRM_CAT, estadoCrm)))} />
                        {nombreDe(catalogos, CRM_CAT, estadoCrm)}
                      </span>
                    )
                  })()}
                  {/* Estado WhatsApp (automático).
                      El nombre y el color salen del catálogo: esta lista la
                      edita el administrador —y la 027 ya archivó dos valores—,
                      así que escrita aquí se quedaría vieja al primer cambio.
                      Un valor que no esté catalogado sigue leyéndose: nombreDe
                      cae al valor crudo y el punto, a gris.

                      Sobre la foto no vale la pastilla de claseColor: sus tonos
                      están pensados para el fondo del panel, no para una imagen
                      oscura. El color va en el punto y el texto en blanco,
                      igual que la chapa del estado del inmueble. */}
                  {(() => {
                    // La fila llega sin tipar del cliente de Supabase: se
                    // estrecha una vez a lo que hace falta, en vez de repetir
                    // el mismo `as any` por cada uso dentro del JSX.
                    const { estado_whatsapp: estadoWA } = data as { estado_whatsapp?: string | null }
                    if (!estadoWA) return null
                    const color = colorDe(catalogos, WA_CAT, estadoWA)
                    return (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-black/50 text-white/80 border border-white/10">
                        <MessageCircle className="h-2.5 w-2.5" />
                        <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(color))} />
                        {nombreDe(catalogos, WA_CAT, estadoWA)}
                      </span>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* La señal, lo primero que se lee al abrir la ficha.
                Es la razón por la que el agente la está abriendo: el sistema ha
                entendido que este propietario está interesado o que pide que le
                llamen. Va en una banda propia y no como una chapa más sobre la
                foto porque ahí competiría con los tres estados y se perdería.
                Sin señal no se pinta nada: una banda apagada sería una fila
                vacía en todas las fichas.

                Aquí sí vale la pastilla del catálogo (claseColor): va sobre el
                fondo del panel, que es para lo que están pensados sus tonos en
                claro y en oscuro. */}
            {(() => {
              const { senal, senal_en } = data as { senal?: string | null; senal_en?: string | null }
              if (!senal) return null
              const desde = msDe(senal_en)
              return (
                <div className={cn(
                  "flex items-center gap-2 border-b px-4 py-2.5 shrink-0",
                  claseColor(colorDe(catalogos, SENAL_CAT, senal)),
                )}>
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-semibold truncate">
                    {nombreDe(catalogos, SENAL_CAT, senal)}
                  </span>
                  {/* Sin sello no se inventa un "hace un rato": la señal se
                      enseña igual, que es lo que importa. */}
                  {desde !== null && (
                    <>
                      <span aria-hidden className="opacity-40">·</span>
                      <time
                        dateTime={senal_en ?? undefined}
                        title={FECHA_HORA.format(desde)}
                        className="text-xs opacity-90 whitespace-nowrap"
                      >
                        {ahora === null ? FECHA.format(desde) : cuando(desde, ahora)}
                      </time>
                    </>
                  )}
                </div>
              )
            })()}

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
                onClick={() => setTab("notas")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                  tab === "notas"
                    ? "border-violet-500 text-violet-500"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <StickyNote className="h-4 w-4" />
                Notas
                {interacciones.length > 0 && (
                  <span className="text-[11px] tabular-nums opacity-70">{interacciones.length}</span>
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

              {/* La pestaña de trabajo: se atiende arriba y lo apuntado queda
                  debajo. El hueco entre las piezas lo pone este `gap`. */}
              {tab === "notas" && (
                <div className="flex flex-col gap-5">
                  <Atendido
                    captacionId={data.id}
                    catalogos={catalogos}
                    yaAtendido={yaAtendido}
                    // Atender apunta la nota, puede dejar un recordatorio y, si la
                    // captación no tenía dueño, se la queda quien la atiende: hay
                    // que releer la ficha entera, no sólo el historial. Sin
                    // esqueleto: hacer desaparecer media ficha cada vez que se
                    // guarda una nota se lee como que algo ha fallado.
                    //
                    // Y avisar al padre: el agente y el sello de atención se ven
                    // en la tarjeta de la lista, que si no se queda con lo de
                    // antes hasta recargar la página.
                    onHecho={() => { void load(); onCambio?.() }}
                  />

                  {isAdmin && !hideWhatsApp && (
                    // El `key` no es decorativo: el panel de detalle no se
                    // desmonta al pasar de una captación a otra, así que sin él
                    // este trozo se quedaba con el borrador, la conversación y
                    // el teléfono tecleado de la ficha anterior —y "Enviar"
                    // mandaba el mensaje de A al propietario de B—. Además corta
                    // la carrera: la conversación de A que llega tarde cae en un
                    // componente ya desmontado en vez de pintarse sobre la de B.
                    // Contactar cambia `estado_whatsapp`, que es una de las
                    // pastillas de la tarjeta de la lista: el padre también se
                    // tiene que enterar.
                    <WhatsAppPanel key={data.id} captacion={data} catalogos={catalogos} onUpdate={() => { void load(); onCambio?.() }} />
                  )}

                  <LineaTiempo
                    interacciones={interacciones}
                    catalogos={catalogos}
                    personas={personas}
                    yoId={yoId}
                    isAdmin={isAdmin}
                    captacionId={data.id}
                    // Esta lista la pide el propio panel, así que el
                    // `router.refresh()` de dentro no le recarga nada: cada
                    // anotación y cada borrado avisan para volver a leerla.
                    onCambio={() => load()}
                  />
                </div>
              )}

              {tab === "info" && (
                <div className="flex flex-col gap-5">

                  {/* El salto, y el único paso del recorrido que no se podía dar
                      con el ratón. Va lo primero de la pestaña porque es la
                      ACCIÓN; todo lo que hay debajo son datos.

                      Fuera del bloque del propietario a propósito: una captación
                      sin nombre ni teléfono no pintaba aquel bloque, y entonces
                      el botón desaparecía justo en el caso en el que la función
                      SQL tiene algo útil que decir ("añade el teléfono antes de
                      promocionar"). El hueco entre el texto y el botón lo pone
                      el `gap` del contenedor; ningún hijo lleva margen. */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Prospecto</p>
                    {prospectoId ? (
                      <Link
                        href={rutaProspecto(prospectoId)}
                        className="flex items-center justify-center gap-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/60"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        Ver prospecto
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
                        <p className="text-xs text-muted-foreground">
                          Cuando el propietario dice que sí, esto deja de ser un anuncio
                          ajeno: se copia la ficha para poder trabajarla y se congela quién
                          lo captó.
                        </p>
                        <button
                          onClick={() => setConfirmProspecto(true)}
                          disabled={promocionando}
                          className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-violet-500/30 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10 hover:border-violet-500/60 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          {promocionando
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pasando a prospecto…</>
                            : <><Building2 className="h-3.5 w-3.5" /> Pasar a prospecto</>
                          }
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quién la lleva. Vivía en la pestaña de agenda, que ya no
                      existe; el panel sólo asigna y traspasa, que es lo único de
                      aquella pantalla que se sigue usando. */}
                  {isAdmin && (
                    <AgendaPanel
                      captacionId={data.id}
                      agentes={agentes}
                      initial={{ agente_id: data.agente_id }}
                      // Traspasar cambia el agente que la tarjeta de la lista
                      // enseña a la izquierda: sin avisar al padre, esa tarjeta
                      // seguía con el agente viejo hasta recargar la página y el
                      // traspaso parecía no haberse guardado.
                      onUpdate={() => { void load(); onCambio?.() }}
                    />
                  )}

                  {/* Propietario */}
                  {(data.nombre || data.telefono) && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Propietario</p>
                      {/* El hueco entre el nombre, el teléfono y el botón lo pone
                          este `gap`: ningún hijo lleva margen propio. */}
                      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
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
                            // Qué lista nombra esta fila. `estado` (el texto de
                            // Idealista) no tiene catálogo y se pinta en crudo,
                            // pero con la misma forma: era la única que se
                            // pintaba como pastilla y las de estado_crm,
                            // estado_whatsapp y senal caían al renglón suelto
                            // "estado_whatsapp: Enviado → Interesado".
                            const tipoCat = CAT_POR_CAMPO[h.campo]
                            const isEstado = h.campo === "estado" || !!tipoCat
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
                              // Sin catálogo (el `estado` de Idealista) el valor
                              // se enseña tal cual y la pastilla sale gris: es
                              // texto libre del portal, no una lista nuestra.
                              const nombre = (v: string | null) =>
                                tipoCat ? nombreDe(catalogos, tipoCat, v) : v ?? "—"
                              content = (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {h.valor_anterior && (
                                    <span className="text-xs text-muted-foreground">{nombre(h.valor_anterior)}</span>
                                  )}
                                  {h.valor_anterior && <span className="text-xs text-muted-foreground">→</span>}
                                  <span className={cn(
                                    "text-xs px-1.5 py-0.5 rounded border font-medium",
                                    claseColor(tipoCat ? colorDe(catalogos, tipoCat, h.valor_nuevo) : null),
                                  )}>
                                    {nombre(h.valor_nuevo)}
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
        ) : fallo ? (
          /* Sin esto, una ficha que no carga es un panel en blanco del que sólo
             se sale adivinando que hay que pulsar fuera. */
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">No se pudo cargar esta captación.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setFallo(false); setLoading(true); void load({ otraFicha: true }) }}
                className="h-8 rounded-md border border-violet-500/30 px-3 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10"
              >
                Reintentar
              </button>
              <button
                onClick={onClose}
                className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Los dos avisos de "esto no se deshace" ──
          Como diálogo de la propia aplicación y no como `confirm()` del
          navegador. El nativo lo cancelan solos los navegadores incrustados —el
          panel de vista previa, una webview, un móvil con los diálogos
          bloqueados—, así que el botón parecía roto: se pulsaba, la función
          devolvía false y no pasaba nada, ni aviso ni error. Es el mismo patrón
          que ya usan las acciones en masa de `captaciones-list.tsx`. */}
      {confirmProspecto && data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-foreground">¿Pasar a prospecto?</h3>
              <p className="text-sm text-muted-foreground">
                Se crea la ficha del piso con lo que ya sabemos y a partir de ahí es
                nuestra, no un anuncio de Idealista. Quién la captó se queda fijado, y
                desde aquí no se deshace.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmProspecto(false)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handlePasarAProspecto}
                disabled={promocionando}
                className="h-9 px-4 rounded-md bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {promocionando ? "Pasando..." : "Sí, pasar a prospecto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBaja && data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-foreground">¿Dar de baja esta captación?</h3>
              <p className="text-sm text-muted-foreground">
                Pasa a la papelera y puedes restaurarla desde allí. Si la lleva algún
                agente, deja de ser suya.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmBaja(false)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleDarDeBaja}
                disabled={dandoDeBaja}
                className="h-9 px-4 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {dandoDeBaja ? "Dando de baja..." : "Sí, dar de baja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
