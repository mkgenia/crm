"use client"

import { Fragment, useEffect, useRef, useState, type ComponentProps } from "react"
import { DetailPanel } from "./detail-panel"
import { PapeleraList } from "./papelera-list"
import { MapPin, Home, CalendarClock, Search, LayoutGrid, List, KanbanSquare, PhoneOff, Trash2, Loader2, CheckSquare, Square, Trash, Building2, UserMinus } from "lucide-react"
import { CaptacionesPipeline } from "./captaciones-pipeline"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import { ESTADO_COLORS, AGENDA_COLORS, type EstadoAgenda } from "@/types/captaciones"
import { type Catalogo, opcionesDe, nombreDe, colorDe, claseColor, clasePunto } from "@/lib/catalogos"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { darDeBajaMasivo, asignarAgentesMasivo, getCaptaciones } from "@/lib/actions/captaciones"
import { quitarAgenteCaptaciones } from "@/lib/actions/asignacion"

type Captacion = Awaited<ReturnType<typeof getCaptaciones>>["filas"][number]
type AgenteInfo = { id: string; nombre: string; apellidos: string | null; avatar_url: string | null }

/**
 * Las de la papelera NO son `Captacion`: vienen de otra consulta, con la mitad
 * de columnas. Declararlas aquí como `Captacion` obligaba a la página a colarlas
 * con un `as any`, y ese `any` se habría tragado también el día que la papelera
 * dejara de traer una columna que aquí se usa. Se toma la forma del componente
 * que de verdad las pinta, que es quien manda.
 */
type Eliminada = ComponentProps<typeof PapeleraList>["initialData"][number]

/*
 * Las pastillas de la lista salen de dos catálogos —`senal_interes` y
 * `estado_whatsapp`— con su nombre, su color y su orden tal y como estén en
 * /configuracion/catalogos. Son dos preguntas distintas:
 *
 *   senal_interes   -> ¿qué ha entendido la IA?  Le interesa · Quiere llamada
 *   estado_whatsapp -> ¿ha contestado?           Enviado · Respondido · …
 *
 * No hay lista escrita aquí a propósito. Antes filtraban por quién la tenía
 * asignada y cómo estaba la agenda ("Sin asignar 795", "Agendadas 85"), que no
 * dice nada de cómo va una captación; y aunque se cambiaran por los estados
 * buenos, escribirlos aquí significaría que un estado nuevo no aparece hasta
 * que alguien despliegue. Que es exactamente lo que pasaba con los leads.
 *
 * Si sobran pastillas, se archiva el valor en el panel de catálogos y
 * desaparece de aquí sola. Eso es justo lo que pasó con `Interesado` y
 * `Quiere_Llamada` en la 027: se archivaron como estado y renacieron como
 * señal, y esta pantalla no tuvo que aprenderse sus nombres.
 */

/**
 * La pastilla de un valor de catálogo: punto, color y nombre salen de ahí.
 *
 * El fallback importa tanto como el caso bueno. Un valor que ya no esté
 * catalogado —una fila vieja con un estado archivado— se pinta en gris con su
 * propio valor: `nombreDe` cae al valor y `claseColor`/`clasePunto` caen al
 * gris, así que nada revienta ni desaparece de la pantalla.
 */
function PastillaCatalogo({ catalogos, tipo, valor }: { catalogos: Catalogo[]; tipo: string; valor: string | null }) {
  if (!valor) return null
  const color = colorDe(catalogos, tipo, valor)
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
      claseColor(color),
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", clasePunto(color))} />
      {nombreDe(catalogos, tipo, valor)}
    </span>
  )
}

function fmt(n: number | null) {
  if (!n) return "—"
  return `${n.toLocaleString("es-ES")} €`
}

/**
 * La fecha de la cita, con locale y zona fijos.
 *
 * Esta lista se pinta primero en el servidor —la primera página llega ya
 * renderizada— y el servidor corre en UTC mientras el navegador va en Madrid:
 * dejando que cada uno pusiera la suya, la misma cita salía con una hora a cada
 * lado y React lo cantaba como desajuste al hidratar. Y el mes en número por lo
 * mismo que en `detail-panel`: el ICU de Node y el del navegador no siempre
 * abrevian igual ("sept" / "sep").
 */
const FECHA_AGENDA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
})

function fmtFecha(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  // `format` de Intl NO perdona una fecha ilegible: lanza RangeError y se
  // llevaría por delante el render de la lista entera. `toLocaleString` se
  // limitaba a escribir "Invalid Date", así que esto no sobra.
  if (Number.isNaN(d.getTime())) return null
  return FECHA_AGENDA.format(d)
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

/**
 * ¿Esta captación ya es un prospecto?
 *
 * Lo dice `captaciones.prospecto_id`, la uuid que escribe `promocionar_captacion`
 * al promocionarla. Se lee ensanchando el tipo de la fila y no a pelo porque la
 * consulta de la lista todavía no pide esa columna, y eso se arregla en
 * `lib/actions/captaciones.ts`, que no es fichero de este encargo: hasta que
 * entre en el `select` llega `undefined` y la chapa no se pinta; el día que
 * entre, se pinta sola sin tocar nada de aquí.
 *
 * El `!= null` mete en el mismo saco "no vino la columna" y "no está
 * promocionada", que para lo que hay que decidir aquí es lo mismo: sin chapa.
 */
function esProspecto(cap: Captacion) {
  const { prospecto_id } = cap as Captacion & { prospecto_id?: string | number | null }
  return prospecto_id != null
}

/**
 * La chapa de "esto ya va por el otro embudo".
 *
 * Sin ella el comercial abre la ficha creyendo que le toca llamar, y resulta
 * que la captación es un prospecto desde hace tres días y lo lleva otro. Color
 * fijo y no de catálogo a propósito: no es un estado que nadie vaya a renombrar
 * desde el panel, es un hecho —tiene `prospecto_id` o no lo tiene—.
 */
function ChapaProspecto() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
      <Building2 className="h-2.5 w-2.5" /> Prospecto
    </span>
  )
}

function CaptacionCard({ cap, catalogos, onClick, selected, onSelect }: { cap: Captacion; catalogos: Catalogo[]; onClick: () => void; selected?: boolean; onSelect?: (e: React.MouseEvent) => void }) {
  const estado = estadoVisible(cap.estado)
  const estadoStyle = estado ? (ESTADO_COLORS[estado] ?? { bg: "bg-muted", text: "text-muted-foreground" }) : null
  const prospecto = esProspecto(cap)

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
        {/* Precio + operación. Sin el distintivo, "1.250 €" en un listado que mezcla
            venta y alquiler no se sabe si es una ganga o una renta mensual. */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          <span className="bg-black/70 backdrop-blur-sm rounded-md px-2 py-1 text-white text-sm font-semibold">
            {fmt(cap.precio)}
            {cap.operacion === "rent" && <span className="font-normal opacity-75">/mes</span>}
          </span>
          {cap.operacion === "rent" && (
            <span className="bg-sky-500/90 backdrop-blur-sm rounded-md px-1.5 py-1 text-[10px] font-bold tracking-wide text-white">
              ALQUILER
            </span>
          )}
        </div>
        {/* Sin teléfono */}
        {!hasPhone(cap.telefono) && (
          <div className="absolute top-2 left-2">
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/90 text-white">
              <PhoneOff className="h-2.5 w-2.5" /> Sin tel.
            </span>
          </div>
        )}
        {/* Arriba a la derecha van dos cosas y se apilan con `gap`, no con un
            `mt-` en la de abajo. La chapa de prospecto manda sobre el estado del
            piso: una cambia lo que hay que hacer con la ficha, la otra sólo
            cuenta cómo está el piso por dentro. */}
        {(prospecto || (estadoStyle && estado)) && (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {prospecto && <ChapaProspecto />}
            {estadoStyle && estado && (
              <span className={cn("text-xs px-2 py-0.5 rounded font-medium", estadoStyle.bg, estadoStyle.text)}>
                {estado}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
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

        {/* La conversación, en dos trozos porque son dos preguntas: si ha
            contestado (`estado_whatsapp`) y qué entendió la IA de lo que
            contestó (`senal`). Antes esto era un mapa de colores y etiquetas
            escrito aquí mismo, con `Interesado` y `Quiere_Llamada` dentro: el
            día que la 027 los archivó, esta tarjeta habría seguido pintándolos
            —y sin la señal— hasta que alguien lo viera. Ahora sale del
            catálogo, y renombrar o recolorear un valor es cosa del panel. */}
        {(cap.estado_whatsapp || cap.senal) && (
          <div className="flex items-center gap-2 flex-wrap">
            {cap.estado_whatsapp && (
              <span className="flex items-center gap-1.5">
                {/* El punto late para que se vea desde lejos cuál se ha movido. */}
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0 animate-[pulse_2s_ease-in-out_infinite]",
                  clasePunto(colorDe(catalogos, "estado_whatsapp", cap.estado_whatsapp)),
                )} />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {nombreDe(catalogos, "estado_whatsapp", cap.estado_whatsapp)}
                </span>
              </span>
            )}
            {/* La señal va en pastilla y no en texto suelto: es lo que decide a
                quién se llama hoy, y tiene que ganar el ojo al estado. */}
            <PastillaCatalogo catalogos={catalogos} tipo="senal_interes" valor={cap.senal} />
          </div>
        )}

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

function CaptacionRow({ cap, catalogos, onClick, selected, onSelect }: { cap: Captacion; catalogos: Catalogo[]; onClick: () => void; selected?: boolean; onSelect?: () => void }) {
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
      <div className="min-w-0 flex flex-col gap-0.5">
        {/* La chapa va pegada a la calle y con `shrink-0`: si encoge ella, el
            recorte se come "Prospecto" antes que la dirección, y la chapa
            existe justo para verse de un vistazo. */}
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-foreground truncate group-hover:text-violet-400 transition-colors">
            {cap.calle ?? "Sin dirección"}
          </p>
          {esProspecto(cap) && <ChapaProspecto />}
        </div>
        <p className="text-xs text-muted-foreground truncate">
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

      {/* WhatsApp: el estado arriba y, si la hay, la señal debajo. Apiladas y
          no en fila porque la columna mide 7rem y "Quiere llamada" al lado de
          "Ha respondido" se saldría. */}
      <div className="flex flex-col items-center gap-1">
        {sinTel ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
            <PhoneOff className="h-3 w-3" /> Sin tel.
          </span>
        ) : (
          <PastillaCatalogo catalogos={catalogos} tipo="estado_whatsapp" valor={cap.estado_whatsapp} />
        )}
        <PastillaCatalogo catalogos={catalogos} tipo="senal_interes" valor={cap.senal} />
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
  /** Primera página, ya renderizada en el servidor. */
  initialData: Captacion[]
  /** Total real de esa primera consulta, contado en la base de datos. */
  initialTotal: number
  eliminadas?: Eliminada[]
  total: number
  /** Contadores por estado de WhatsApp. `null` = ese contador falló al leerse. */
  totalesEstado: Record<string, number | null>
  /**
   * Contadores por señal (`interesado`, `quiere_llamada`). Mismo trato del null.
   *
   * Obligatoria, como `totalesEstado`, y no opcional con `= {}`: ese objeto por
   * defecto sería nuevo en cada render y está en las dependencias del efecto
   * que vuelca los contadores, así que el efecto no pararía nunca.
   */
  totalesSenal: Record<string, number | null>
  /** Los catálogos activos: de aquí salen las pastillas, sus nombres y colores. */
  catalogos?: Catalogo[]
  isAdmin?: boolean
  agentes?: AgenteInfo[]
}

export function CaptacionesList({ initialData, initialTotal, eliminadas = [], total, totalesEstado, totalesSenal, catalogos = [], isAdmin = true, agentes = [] }: Props) {
  /*
   * Las pastillas, en dos grupos y en este orden a propósito:
   *
   *   Todas · [señal] · [estado de WhatsApp]
   *
   * "Le interesa" y "Quiere llamada" van delante de los estados porque son las
   * dos que el comercial mira de verdad: son la lista de a quién hay que llamar
   * hoy. Y filtran por la columna `senal`, no por el estado — desde la 027 un
   * interesado está en `Respondido` como todos los demás, así que buscarlo por
   * estado ya no lo encuentra.
   *
   * "Todas" se queda la primera: no es un estado, es quitar el filtro.
   */
  const pastillasSenal = opcionesDe(catalogos, "senal_interes")
  const pastillasEstado = opcionesDe(catalogos, "estado_whatsapp")
  // `grupo` no pinta nada: es la mitad de la clave de React. Los dos catálogos
  // los edita el administrador y podrían llegar a compartir un `valor` (los que
  // crea el panel son minúsculas, así que un estado llamado "Interesado" daría
  // "interesado", que ya es una señal). Con la clave sólo en `valor`, ese día
  // React tendría dos hermanos con la misma y se comería una pastilla.
  const FILTROS = [
    { key: "todas", grupo: "todas", label: "Todas", color: null as string | null },
    ...pastillasSenal.map((c) => ({ key: c.valor, grupo: "senal", label: c.nombre, color: c.color })),
    ...pastillasEstado.map((c) => ({ key: c.valor, grupo: "estado", label: c.nombre, color: c.color })),
  ]

  const [selected, setSelected] = useState<number | null>(null)
  const [texto, setTexto] = useState("")
  const [search, setSearch] = useState("")
  const [filtro, setFiltro] = useState("todas")
  const [vista, setVista] = useState<"grid" | "list" | "pipeline">("grid")
  const [tab, setTab] = useState<"activas" | "papelera">("activas" as "activas" | "papelera")
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set())
  const [bajaLoading, setBajaLoading] = useState(false)
  const [asignarLoading, setAsignarLoading] = useState(false)
  const [showAsignarMenu, setShowAsignarMenu] = useState(false)
  const [confirmBaja, setConfirmBaja] = useState(false)
  const [quitarLoading, setQuitarLoading] = useState(false)
  /**
   * Quitar el agente EN MASA sí pregunta antes, al revés que el botón de la
   * ficha.
   *
   * No es una manía de coherencia con los otros dos diálogos: en la ficha,
   * quitar tiene vuelta atrás de un clic porque la rejilla de agentes se queda
   * ahí al lado. Sobre cincuenta seleccionadas no la tiene — reasignarlas en
   * masa se las da TODAS al mismo agente, que no es el estado anterior, y quién
   * llevaba cada una ya no está en pantalla para reconstruirlo.
   */
  const [confirmQuitar, setConfirmQuitar] = useState(false)
  const [pendingAgente, setPendingAgente] = useState<AgenteInfo | null>(null)

  // La página que se ve y su total, las dos cosas traídas del servidor. Filtrar
  // y buscar también se hacen allí: con 50 filas en memoria, filtrar en el
  // cliente sólo miraría esas 50 y el resto de las 1.031 no existiría.
  const [filas, setFilas] = useState<Captacion[]>(initialData)
  const [totalFiltrado, setTotalFiltrado] = useState(initialTotal)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [recarga, setRecarga] = useState(0)

  // Contadores de las pastillas, todos contados en la base de datos con
  // `head: true`. Contarlos sobre las filas cargadas daría 50 siempre, que es
  // el número que miente y que veníamos quitando de todas partes.
  //
  // `ajustes` son los que devuelve la propia lista al filtrar, que llegan antes
  // que los del servidor. La mezcla se hace AQUÍ, en el render, y no en un
  // efecto que volcaba las props a un estado: un setState síncrono dentro de un
  // efecto encadena un render de más y el lint del compilador lo rechaza.
  // Derivándolo, además, unos totales nuevos —los que llegan al revalidar tras
  // una baja masiva— se ven solos, sin efecto que los copie ni carrera entre el
  // volcado y la recarga de la lista.
  //
  // Si un valor estuviera en los dos catálogos gana la señal, igual que en el
  // servidor: la pastilla y el número que enseña tienen que contar lo mismo.
  const [ajustes, setAjustes] = useState<Record<string, number | null>>({})
  const totalesFiltro: Record<string, number | null> = {
    todas: total,
    ...totalesEstado,
    ...totalesSenal,
    ...ajustes,
  }

  /*
   * Trece pastillas, siete de ellas a cero y la barra partida en dos líneas.
   * Las de estado que no tienen ni una captación se esconden: pulsarlas sólo
   * lleva a una lista vacía, y de paso empujan abajo a las que sí sirven.
   *
   * Tres excepciones, y las tres tienen motivo:
   *
   *   · La pulsada no se esconde nunca. Si al filtrar por ella se queda a cero
   *     —o se dan de baja las últimas que tenía— desaparecería justo bajo el
   *     dedo del que acaba de pulsarla, y con ella la pista de dónde está uno.
   *   · "Todas" y las señales se quedan siempre. Que "Quiere llamada" diga 0 es
   *     lo que el comercial viene a mirar: hoy nadie ha pedido que le llamen.
   *     Esconderla contaría lo mismo, pero como si fuera un fallo de la pantalla.
   *   · Sólo se esconde el cero exacto. Un contador que no se pudo leer llega
   *     como `null` y `null` no sabe si hay cero o mil; esa pastilla se queda,
   *     sin número, igual que se pinta en el resto del CRM.
   */
  const pastillas = FILTROS.filter(
    (f) => f.grupo !== "estado" || f.key === filtro || totalesFiltro[f.key] !== 0
  )

  // La rayita separa las dos preguntas —qué ve la IA · si ha contestado— y se
  // decide sobre las que quedan. Marcada de antemano en el catálogo, esconder
  // la primera pastilla de estado se llevaba la raya por delante; y sin mirar
  // si queda alguna señal, la raya abriría la fila ella sola.
  const haySenal = pastillas.some((f) => f.grupo === "senal")
  const primerEstado = pastillas.findIndex((f) => f.grupo === "estado")

  // El buscador escribe en `texto` y sólo consulta cuando el agente para de
  // teclear: si no, "Ruzafa" son seis consultas y seis repintados de la lista.
  useEffect(() => {
    const t = setTimeout(() => setSearch(texto.trim()), 300)
    return () => clearTimeout(t)
  }, [texto])

  const primeraCarga = useRef(true)
  useEffect(() => {
    // La primera página ya llega renderizada desde el servidor: volver a pedirla
    // al montar sería una consulta de más en cada visita a la pantalla.
    if (primeraCarga.current) {
      primeraCarga.current = false
      return
    }

    let cancelado = false
    setCargando(true)
    getCaptaciones({ filtro, search, pagina, porPagina: POR_PAGINA })
      .then((res) => {
        if (cancelado) return
        setFilas(res.filas)
        setTotalFiltrado(res.total)
        // Si la página en la que estás deja de existir —das de baja media lista,
        // o el filtro tiene menos páginas— el servidor devuelve un tramo vacío
        // con el total bueno, y aquí se salta a la última que sí existe. Va en
        // la respuesta y no en un efecto aparte porque un setState síncrono
        // dentro de un efecto encadena un render de más y el lint lo rechaza.
        const ultima = Math.max(1, Math.ceil(res.total / POR_PAGINA))
        if (pagina > ultima) setPagina(ultima)
        // Con búsqueda el total es el de la búsqueda, no el del filtro.
        if (!search) setAjustes((prev) => ({ ...prev, [filtro]: res.total }))
      })
      .catch((e: unknown) => {
        // El mensaje real no se enseña: en producción Next tapa lo que lanza una
        // server action con un texto genérico sobre digests que no dice nada al
        // agente. El detalle, a la consola.
        console.error("[captaciones] no se pudo cargar la página", e)
        if (!cancelado) toast.error("No se pudieron cargar las captaciones")
      })
      .finally(() => { if (!cancelado) setCargando(false) })

    // Da por obsoleta la respuesta anterior: tecleando o pasando páginas deprisa
    // llegan desordenadas, y la última en llegar no tiene por qué ser la buena.
    return () => { cancelado = true }
  }, [filtro, search, pagina, recarga])

  // Volver a la página 1 se hace aquí y no en un efecto sobre [filtro, search]:
  // ese efecto correría con la página vieja todavía puesta y dispararía una
  // consulta tirada antes de la buena. Si estás en la 9 y filtras por algo con
  // 20 resultados, sin esto te quedas mirando una página vacía.
  function cambiarFiltro(key: string) {
    setFiltro(key)
    setPagina(1)
  }

  function cambiarTexto(valor: string) {
    setTexto(valor)
    setPagina(1)
  }

  const todosSeleccionados = filas.length > 0 && filas.every((c) => seleccionados.has(c.id))

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTodos() {
    if (todosSeleccionados) {
      setSeleccionados(new Set())
    } else {
      setSeleccionados(new Set(filas.map((c) => c.id)))
    }
  }

  /**
   * Tras una acción masiva los contadores que devolvió la lista se quedan
   * viejos: se tiran y se vuelve a pedir la página. Los de las props llegan
   * recalculados solos al revalidar el servidor; los `ajustes` no, y sin
   * vaciarlos taparían a los nuevos para siempre, porque van encima.
   */
  function recargarLista() {
    setAjustes({})
    setRecarga((n) => n + 1)
  }

  async function handleDarDeBajaMasivo() {
    if (!seleccionados.size) return
    const cuantas = seleccionados.size
    setConfirmBaja(false)
    setBajaLoading(true)
    try {
      const res = await darDeBajaMasivo(Array.from(seleccionados))
      if (res.error) { toast.error(res.error); return }
      toast.success(`${cuantas} captaciones dadas de baja`)
      setSeleccionados(new Set())
      // La lista vive ahora en el cliente: sin volver a pedirla, las bajas
      // seguirían en pantalla hasta recargar la página entera.
      recargarLista()
    } catch (e: unknown) {
      // Sin este catch, un fallo de red deja el botón girando para siempre: el
      // `await` lanza y el `setBajaLoading(false)` de después nunca corre. El
      // mensaje real va a la consola porque en producción Next lo sustituye por
      // un texto de digest que no le dice nada al agente.
      console.error("[captaciones] no se pudo dar de baja la selección", e)
      toast.error("No se pudieron dar de baja. Vuelve a intentarlo.")
    } finally {
      setBajaLoading(false)
    }
  }

  function handleAsignarAgente(agente: AgenteInfo) {
    if (!seleccionados.size) return
    setShowAsignarMenu(false)
    setPendingAgente(agente)
  }

  async function confirmarAsignacion() {
    if (!pendingAgente || !seleccionados.size) return
    // El agente y el recuento se copian antes de vaciar el diálogo: el toast de
    // abajo los lee después del await, cuando `pendingAgente` ya es null.
    const agente = pendingAgente
    const cuantas = seleccionados.size
    setPendingAgente(null)
    setAsignarLoading(true)
    try {
      const res = await asignarAgentesMasivo(Array.from(seleccionados), agente.id)
      if (res.error) { toast.error(res.error); return }
      toast.success(`${cuantas} captaciones asignadas a ${agente.nombre}`)
      setSeleccionados(new Set())
      recargarLista()
    } catch (e: unknown) {
      // Mismo motivo que en la baja masiva: sin catch, un fallo de red deja
      // "Asignar agente" girando y sin forma de volver a intentarlo.
      console.error("[captaciones] no se pudo asignar la selección", e)
      toast.error("No se pudieron asignar. Vuelve a intentarlo.")
    } finally {
      setAsignarLoading(false)
    }
  }

  /**
   * Dejar sin agente las seleccionadas.
   *
   * Esto es lo que faltaba el día que hubo que vaciar la cuenta de una agente
   * con un script contra la base: veinticuatro captaciones que por pantalla no
   * había forma de soltar. NO es un rechazo —el mismo agente puede volver a
   * recibirlas—, y el lead espejo de cada una se queda sin agente solo, por el
   * trigger de la migración 026.
   */
  async function handleQuitarAgenteMasivo() {
    if (!seleccionados.size) return
    setConfirmQuitar(false)
    setQuitarLoading(true)
    try {
      const res = await quitarAgenteCaptaciones(Array.from(seleccionados))
      if (res.error) { toast.error(res.error); return }
      // Sin número, al revés que la asignación y la baja masivas. Ahí el número
      // es verdad —se asigna o se da de baja todo lo marcado—, pero aquí el
      // servidor sólo toca las que TIENEN agente, y con 696 activas sin agente
      // lo normal es que la selección lleve muchas que no cambian. Decir "50
      // captaciones se han quedado sin agente" cuando se soltaron doce es
      // cantar un recuento que nadie ha contado.
      toast.success("Las seleccionadas que tenían agente se han quedado sin asignar")
      setSeleccionados(new Set())
      recargarLista()
    } catch (e: unknown) {
      // Mismo motivo que en las otras dos masivas: sin catch, un fallo de red
      // deja el botón girando y sin forma de volver a intentarlo.
      console.error("[captaciones] no se pudo quitar el agente de la selección", e)
      toast.error("No se pudo quitar el agente. Vuelve a intentarlo.")
    } finally {
      setQuitarLoading(false)
    }
  }

  function seleccionarSinTelefono() {
    const sinTel = filas.filter((c) => !hasPhone(c.telefono)).map((c) => c.id)
    if (!sinTel.length) { toast("No hay captaciones sin teléfono en esta página"); return }
    setSeleccionados(new Set(sinTel))
  }

  if (tab === "papelera") {
    return (
      // El hueco lo pone el `gap` del contenedor, no un `mb-` en la barra de
      // volver: el hijo no tiene por qué saber qué lleva debajo.
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTab("activas")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Volver a activas
          </button>
        </div>
        <PapeleraList initialData={eliminadas} isAdmin={isAdmin} />
      </div>
    )
  }

  return (
    <>
      {/* Los tres bloques en flujo van juntos: el hueco entre ellos lo pone
          este `gap` y no un `mb-` en cada uno. Lo que queda fuera —la ficha y
          los diálogos— es `fixed`, o sea que ni cuenta como hermano ni se ve
          afectado por el gap. */}
      <div className="flex flex-col gap-6">
        {/* Tabs activas / papelera */}
        <div className="flex items-center gap-1 border-b border-border">
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

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            {pastillas.map((f, i) => (
              <Fragment key={`${f.grupo}:${f.key}`}>
                {haySenal && i === primerEstado && <span aria-hidden className="h-5 w-px bg-border" />}
                <button
                  onClick={() => cambiarFiltro(f.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    filtro === f.key
                      ? "bg-violet-500/10 text-violet-500 border border-violet-500/30"
                      : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
                  )}
                >
                  {f.color && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", clasePunto(f.color))} />}
                  {f.label}
                  {/* Si el contador falló se deja en blanco. Pintar un 0 diría "no
                      hay ninguna", que es peor que no decir nada. */}
                  {totalesFiltro[f.key] != null && (
                    <span className={cn("text-xs px-1.5 py-0.5 rounded-full tabular-nums", filtro === f.key ? "bg-violet-500/20" : "bg-muted")}>
                      {totalesFiltro[f.key]!.toLocaleString("es")}
                    </span>
                  )}
                </button>
              </Fragment>
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

                  {/* Quitar el agente. No hace falta la lista de agentes —esto
                      no se lo da a nadie—, así que sale aunque `agentes` venga
                      vacía. Es la acción que hasta hoy había que hacer con un
                      script contra la base para vaciar la cuenta de alguien. */}
                  {isAdmin && (
                    <button
                      onClick={() => setConfirmQuitar(true)}
                      disabled={quitarLoading}
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {quitarLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                      Quitar agente
                    </button>
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
                  value={texto}
                  onChange={(e) => cambiarTexto(e.target.value)}
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
            {/* Dice "esta página" a propósito: la selección alimenta la baja
                masiva y sólo alcanza a las filas cargadas. */}
            <button onClick={toggleTodos} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {todosSeleccionados
                ? <CheckSquare className="h-3.5 w-3.5 text-violet-500" />
                : <Square className="h-3.5 w-3.5" />
              }
              {todosSeleccionados ? "Deseleccionar" : "Seleccionar esta página"}
            </button>
            <p className="text-xs text-muted-foreground tabular-nums">
              {totalFiltrado.toLocaleString("es")} captaciones
            </p>
            {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

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

        <div className="flex flex-col gap-6">
          {vista === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filas.map((c) => (
                <CaptacionCard
                  key={c.id}
                  cap={c}
                  catalogos={catalogos}
                  selected={seleccionados.has(c.id)}
                  onSelect={(e) => { e.stopPropagation(); toggleSeleccion(c.id) }}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </div>
          ) : vista === "list" ? (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <ListHeader />
              {filas.map((c) => (
                <CaptacionRow
                  key={c.id}
                  cap={c}
                  catalogos={catalogos}
                  selected={seleccionados.has(c.id)}
                  onSelect={() => toggleSeleccion(c.id)}
                  onClick={() => setSelected(c.id)}
                />
              ))}
            </div>
          ) : (
            <CaptacionesPipeline captaciones={filas} onSelect={(id) => setSelected(id)} />
          )}

          {/* El paginador va también en pipeline: el kanban recibe la misma página
              que las otras vistas, y sin él sus columnas volverían a mentir. */}
          <Paginador
            pagina={pagina}
            porPagina={POR_PAGINA}
            total={totalFiltrado}
            onCambiar={setPagina}
            cargando={cargando}
          />

          {/* La lista vacía sólo se anuncia si el servidor dice que de verdad no
              hay nada. Con `totalFiltrado > 0` y cero filas estamos en el
              fotograma de en medio —la página en la que estabas ya no existe y se
              está pidiendo la última que sí—, y sin esta condición asomaría "no
              hay captaciones" justo antes de enseñar las que sí hay. */}
          {filas.length === 0 && !cargando && totalFiltrado === 0 && (
            <div className="py-20 text-center space-y-2">
              <Home className="h-8 w-8 text-muted-foreground/20 mx-auto" />
              <p className="text-sm text-muted-foreground">
                {texto || filtro !== "todas"
                  ? "No hay captaciones con estos filtros"
                  : isAdmin
                    ? "Aún no hay captaciones. El scraper las importará automáticamente."
                    : "No tienes captaciones asignadas. El admin te asignará propiedades."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* El aviso de la ficha.
          Traspasar el agente, atender o pasar a prospecto desde el panel no
          movía la tarjeta de la izquierda: la lista vive en el cliente y seguía
          enseñando el agente viejo hasta recargar la página entera.

          `onCambio` va como atributo normal y no colado con un spread: pasado
          con spread, TypeScript no comprueba que el panel tenga esa prop, y el
          día que allí se renombre o se caiga el aviso, esto compilaría igual y
          la lista volvería a quedarse muda sin que nadie se entere. Escrito a
          pelo, ese día no compila.

          Se recarga dos veces y no sobra ninguna: `onCambio` repinta la tarjeta
          en cuanto la ficha toca algo —con el panel aún abierto—, y `onClose`
          cubre lo que la ficha cambie sin avisar. Recargar de más cuesta una
          consulta; recargar de menos deja al agente mirando un dato falso. */}
      <DetailPanel
        captacionId={selected}
        onClose={() => { setSelected(null); recargarLista() }}
        onCambio={recargarLista}
        isAdmin={isAdmin}
      />

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

      {/* Confirm dialog: quitar agente masivo */}
      {confirmQuitar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          {/* El hueco entre el texto y los botones lo pone el `gap` del diálogo,
              no un `space-y-*`: eso son márgenes en los hijos, y aquí el espacio
              lo reparte el padre. Los diálogos de al lado todavía llevan lo
              viejo; se irán cambiando cuando se toquen. */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-foreground">
                ¿Quitar el agente a {seleccionados.size} captaciones?
              </h3>
              {/* Se dice lo que NO pasa, porque es lo que la gente teme: esto no
                  es un rechazo (se les puede volver a asignar al mismo agente) y
                  no borra quién trajo cada captación. */}
              <p className="text-sm text-muted-foreground">
                Se quedarán sin asignar y podrás repartirlas de nuevo a quien quieras, incluido el mismo
                agente. No se pierde quién las captó.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmQuitar(false)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleQuitarAgenteMasivo}
                className="h-9 px-4 rounded-md bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors"
              >
                Sí, quitar
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
