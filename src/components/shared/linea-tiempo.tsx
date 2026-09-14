"use client"

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Circle,
  History,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  apuntarInteraccion,
  borrarInteraccion,
  type Interaccion,
} from "@/lib/actions/interacciones"
import { clasePunto, colorDe, nombreDe, opcionesDe, type Catalogo } from "@/lib/catalogos"

/**
 * La línea de tiempo de un contacto: todo lo que ha pasado con él, lo último
 * arriba, y un formulario para apuntar lo siguiente.
 *
 * Sirve igual para un lead que para una captación porque son las dos puntas del
 * mismo negocio y quien lee la ficha quiere una sola lista, no dos.
 */

const TIPO_CAT = "tipo_interaccion"

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

type Direccion = Interaccion["direccion"]

/**
 * El mapa está escrito entero y con las clases literales: Tailwind lee el código
 * fuente para saber qué compilar, y una clase armada con plantilla se purga.
 */
const DIRECCIONES: Record<
  Direccion,
  { Icono: LucideIcon; etiqueta: string; chip: string; texto: string }
> = {
  entrante: {
    Icono: ArrowDownLeft,
    etiqueta: "Entrante",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    texto: "text-emerald-600 dark:text-emerald-400",
  },
  saliente: {
    Icono: ArrowUpRight,
    etiqueta: "Saliente",
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    texto: "text-sky-600 dark:text-sky-400",
  },
  interna: {
    Icono: Circle,
    etiqueta: "Interna",
    chip: "bg-muted text-muted-foreground",
    texto: "text-muted-foreground",
  },
}

const ORDEN_DIRECCIONES: Direccion[] = ["entrante", "saliente", "interna"]

/**
 * El reloj, tratado como lo que es: un sistema externo a React.
 *
 * "Hace 2 h" sale de Date.now(), y esta lista se pinta primero en el servidor y
 * luego se hidrata en el navegador. Si el texto se calculara durante el render,
 * el HTML que llega y el que React produce al hidratar dirían cosas distintas
 * —entre uno y otro pasa tiempo, y los dos relojes ni siquiera van iguales— y
 * React lo cantaría como desajuste de hidratación. Leyéndolo con
 * useSyncExternalStore, el servidor y el primer render del cliente ven null y
 * enseñan la fecha absoluta, que sí es idéntica en los dos lados; ya hidratado,
 * React vuelve a renderizar con la hora de verdad y a partir de ahí el texto es
 * relativo.
 */
const RELOJ = {
  subscribe(alCambiar: () => void) {
    // Cada minuto, para que no envejezca a la vista de quien deja la ficha abierta.
    const t = setInterval(alCambiar, 60_000)
    return () => clearInterval(t)
  },
  // Redondeado al minuto a propósito: getSnapshot tiene que devolver lo mismo
  // mientras nada cambie, y un Date.now() crudo renderizaría sin parar.
  ahora: () => Math.floor(Date.now() / 60_000) * 60_000,
  enServidor: () => null,
}

/** Una dirección desconocida se lee como interna en vez de romper la fila. */
function direccionDe(d: string) {
  return DIRECCIONES[d as Direccion] ?? DIRECCIONES.interna
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
  // El reloj va redondeado al minuto, así que lo que se acaba de apuntar puede
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

export interface PersonaLinea {
  id: string
  nombre: string
}

export function LineaTiempo({
  interacciones,
  catalogos,
  personas,
  yoId,
  isAdmin,
  leadId,
  captacionId,
  onCambio,
}: {
  interacciones: Interaccion[]
  catalogos: Catalogo[]
  personas: PersonaLinea[]
  yoId: string
  isAdmin: boolean
  leadId?: string
  captacionId?: number
  /**
   * Para quien pinte esta lista desde el navegador y no desde el servidor:
   * `router.refresh()` no le recarga nada, así que se le avisa de cada
   * anotación y de cada borrado para que vuelva a pedir la suya.
   */
  onCambio?: () => void
}) {
  const router = useRouter()
  const opciones = useMemo(() => opcionesDe(catalogos, TIPO_CAT), [catalogos])

  const [tipo, setTipo] = useState(() => opciones[0]?.valor ?? "nota")
  const [direccion, setDireccion] = useState<Direccion>("saliente")
  const [resumen, setResumen] = useState("")
  const [detalle, setDetalle] = useState("")
  const [conDetalle, setConDetalle] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [abiertos, setAbiertos] = useState<string[]>([])
  const [ocultos, setOcultos] = useState<string[]>([])

  // null hasta que el componente está hidratado; ver RELOJ.
  const ahora = useSyncExternalStore<number | null>(
    RELOJ.subscribe,
    RELOJ.ahora,
    RELOJ.enServidor,
  )

  const visibles = useMemo(
    () =>
      [...interacciones]
        .filter((i) => !ocultos.includes(i.id))
        .sort((a, b) => new Date(b.ocurrida_en).getTime() - new Date(a.ocurrida_en).getTime()),
    [interacciones, ocultos],
  )

  const puedeApuntar = Boolean(leadId || captacionId)
  const nombrePersona = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? "—"

  async function apuntar(e: FormEvent) {
    e.preventDefault()
    if (!resumen.trim()) return toast.error("Escribe al menos una línea")

    setGuardando(true)
    // El .catch cubre que la acción ni llegue a contestar —red caída, despliegue
    // a mitad—: sin él la promesa se rompía, `guardando` se quedaba en true y el
    // formulario no dejaba volver a intentarlo.
    const r = await apuntarInteraccion({
      leadId,
      captacionId,
      tipo,
      resumen,
      detalle: detalle.trim() || undefined,
      direccion,
    }).catch(() => ({ error: "No se pudo apuntar" }))
    setGuardando(false)

    if (r.error) return toast.error(r.error)
    setResumen("")
    setDetalle("")
    setConDetalle(false)
    router.refresh()
    onCambio?.()
  }

  // Se quita de la lista antes de que conteste el servidor y se devuelve si
  // falla: esperar medio segundo a que una nota desaparezca hace pensar que el
  // botón no ha ido y se pulsa otra vez.
  async function borrar(id: string) {
    setOcultos((xs) => [...xs, id])
    // También se devuelve si la acción se rompe sin contestar: si sólo se mirara
    // `r.error`, una red caída dejaba la anotación escondida para siempre y sin
    // decir nada, que es justo parecer borrada sin estarlo.
    const r = await borrarInteraccion(id).catch(() => ({ error: "No se pudo borrar" }))
    if (r.error) {
      setOcultos((xs) => xs.filter((x) => x !== id))
      return toast.error(r.error)
    }
    router.refresh()
    onCambio?.()
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <History className="h-4 w-4 text-violet-500" />
        <h2 className="text-sm font-semibold text-foreground">Historial</h2>
        {visibles.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">{visibles.length}</span>
        )}
      </div>

      {puedeApuntar && (
        <form onSubmit={apuntar} className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              aria-label="Tipo de anotación"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-violet-500/60"
            >
              {opciones.length === 0 ? (
                <option value="nota">Nota</option>
              ) : (
                opciones.map((o) => (
                  <option key={o.id} value={o.valor}>
                    {o.nombre}
                  </option>
                ))
              )}
            </select>

            {/* Sin este selector todo lo que se apunta a mano nace "interna" y la
                lista pierde justo lo que la hace legible de un vistazo. */}
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {ORDEN_DIRECCIONES.map((d) => {
                const { Icono, etiqueta } = DIRECCIONES[d]
                const activa = direccion === d
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDireccion(d)}
                    title={etiqueta}
                    aria-label={etiqueta}
                    aria-pressed={activa}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded transition-colors",
                      activa
                        ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <Icono className="h-3.5 w-3.5" />
                  </button>
                )
              })}
            </div>

            <input
              value={resumen}
              onChange={(e) => setResumen(e.target.value)}
              placeholder="Llamada de seguimiento: no lo coge"
              className="h-8 min-w-40 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-violet-500/60"
            />

            <button
              type="submit"
              disabled={guardando || !resumen.trim()}
              className="h-8 rounded-md bg-violet-500 px-3 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Apuntar"}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setConDetalle((v) => !v)}
              className="flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus
                className={cn("h-3 w-3 transition-transform duration-200", conDetalle && "rotate-45")}
              />
              {conDetalle ? "Quitar el detalle" : "Añadir detalle"}
            </button>
            {conDetalle && (
              <textarea
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder="El mensaje entero, la nota larga, lo que se dijo…"
                rows={3}
                autoFocus
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-violet-500/60 animate-in fade-in-0 slide-in-from-top-1 duration-150"
              />
            )}
          </div>
        </form>
      )}

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
          <History className="h-5 w-5 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Todavía no hay nada apuntado</p>
          <p className="max-w-xs text-xs text-muted-foreground/70">
            Las llamadas, los WhatsApp y las notas de este contacto irán apareciendo aquí.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-4 px-4 py-4">
          {visibles.map((i, idx) => {
            const dir = direccionDe(i.direccion)
            const { Icono } = dir
            const ms = new Date(i.ocurrida_en).getTime()
            const abierto = abiertos.includes(i.id)
            const puedeBorrar = !i.automatica && (isAdmin || i.agente_id === yoId)
            const ultimo = idx === visibles.length - 1

            return (
              <li key={i.id} className="group relative flex gap-3">
                {/* El raíl que une los puntos. Se corta en el último para que no
                    quede colgando por debajo de la lista. */}
                {!ultimo && (
                  <span
                    aria-hidden
                    className="absolute -bottom-4 left-[10px] top-5 w-px -translate-x-1/2 bg-border"
                  />
                )}

                <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      clasePunto(colorDe(catalogos, TIPO_CAT, i.tipo)),
                    )}
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <span
                      title={dir.etiqueta}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                        dir.chip,
                      )}
                    >
                      <Icono className="h-3 w-3" />
                    </span>
                    <p className="min-w-0 flex-1 break-words text-sm leading-5 text-foreground">
                      {i.resumen}
                    </p>
                    {puedeBorrar && (
                      <button
                        type="button"
                        onClick={() => borrar(i.id)}
                        aria-label="Borrar anotación"
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <time dateTime={i.ocurrida_en} title={FECHA_HORA.format(ms)}>
                      {ahora === null ? FECHA.format(ms) : cuando(ms, ahora)}
                    </time>
                    <span aria-hidden>·</span>
                    <span>{i.automatica ? "automático" : nombrePersona(i.agente_id)}</span>
                    <span aria-hidden>·</span>
                    <span>{nombreDe(catalogos, TIPO_CAT, i.tipo)}</span>
                    {i.direccion !== "interna" && (
                      <>
                        <span aria-hidden>·</span>
                        <span className={dir.texto}>{dir.etiqueta}</span>
                      </>
                    )}
                  </div>

                  {i.detalle && (
                    <>
                      <button
                        type="button"
                        aria-expanded={abierto}
                        onClick={() =>
                          setAbiertos((xs) =>
                            xs.includes(i.id) ? xs.filter((x) => x !== i.id) : [...xs, i.id],
                          )
                        }
                        className="flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 transition-transform duration-200",
                            abierto && "rotate-180",
                          )}
                        />
                        {abierto ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                      {abierto && (
                        <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground animate-in fade-in-0 slide-in-from-top-1 duration-150">
                          {i.detalle}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
