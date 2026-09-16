"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { CalendarDays, Plus, Check, Trash2, ChevronLeft, ChevronRight, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { crearEntrada, eliminarEntrada, getAgenda, marcarCompletado } from "@/lib/actions/agenda"
import {
  DIAS_SEMANA, TIPOS, claveDia, esHoy, horaDe, nombreMes, semanasDelMes, tipoDe,
  tiposDesdeCatalogo,
  type EntradaAgenda, type PersonaAgenda, type TipoAgenda, type TipoEntrada,
} from "@/lib/agenda"
import { claseColor, type Catalogo } from "@/lib/catalogos"

/**
 * Agenda del equipo.
 *
 * Un agente ve y escribe lo suyo. El administrador ve lo de todos y puede
 * apuntarle cosas a cualquiera — por eso cada entrada dice de quién es y quién
 * la escribió: sin eso, a Ana le aparecerían visitas de la nada.
 *
 * El mes se pide al servidor cada vez que se cambia, en vez de traerse el año
 * entero: una agenda de siete personas crece rápido y casi siempre se mira el
 * mes en curso.
 */
export function AgendaPanel({
  entradasIniciales,
  personas,
  yoId,
  isAdmin,
  grande = false,
  catalogos,
}: {
  entradasIniciales: EntradaAgenda[]
  personas: PersonaAgenda[]
  yoId: string
  isAdmin: boolean
  /** En su propia pagina caben celdas mas altas y mas entradas a la vista. */
  grande?: boolean
  /**
   * Los catálogos, para sacar de ahí los tipos de entrada en vez de la lista
   * de respaldo de `lib/agenda`. Es OPCIONAL a propósito: las pantallas que ya
   * los tienen a mano —la portada del agente y /calendario— los pasan y así un
   * tipo nuevo o renombrado desde /configuracion/catalogos aparece solo en el
   * desplegable; las que no, siguen funcionando con el respaldo.
   */
  catalogos?: Catalogo[]
}) {
  const [ancla, setAncla] = useState(() => new Date())
  const [entradas, setEntradas] = useState(entradasIniciales)
  const [diaSel, setDiaSel] = useState(() => claveDia(new Date()))
  const [verDe, setVerDe] = useState<string>("todos")
  const [abriendo, setAbriendo] = useState(false)
  const [cargando, startTransition] = useTransition()

  const semanas = useMemo(() => semanasDelMes(ancla), [ancla])

  // Los tipos que se ofrecen y con los que se pinta. Del catálogo si ha llegado.
  const tipos = useMemo(
    () => (catalogos ? tiposDesdeCatalogo(catalogos) : TIPOS),
    [catalogos]
  )

  // Al cambiar de mes se piden sus entradas. El primer mes ya viene del servidor.
  const [mesCargado, setMesCargado] = useState(() => claveDia(new Date()).slice(0, 7))
  useEffect(() => {
    const mes = `${ancla.getFullYear()}-${String(ancla.getMonth() + 1).padStart(2, "0")}`
    if (mes === mesCargado) return
    const desde = semanas[0][0]
    const hasta = new Date(semanas[5][6])
    hasta.setHours(23, 59, 59, 999)
    startTransition(async () => {
      const r = await getAgenda(desde.toISOString(), hasta.toISOString())
      setEntradas(r.entradas)
      setMesCargado(mes)
    })
  }, [ancla, semanas, mesCargado])

  const visibles = useMemo(
    () => (verDe === "todos" ? entradas : entradas.filter((e) => e.agente_id === verDe)),
    [entradas, verDe]
  )

  const porDia = useMemo(() => {
    const m: Record<string, EntradaAgenda[]> = {}
    for (const e of visibles) {
      const k = claveDia(e.fecha)
      ;(m[k] ??= []).push(e)
    }
    return m
  }, [visibles])

  const delDia = porDia[diaSel] ?? []
  const nombreDe = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? "—"

  async function recargar() {
    const desde = semanas[0][0]
    const hasta = new Date(semanas[5][6])
    hasta.setHours(23, 59, 59, 999)
    const r = await getAgenda(desde.toISOString(), hasta.toISOString())
    setEntradas(r.entradas)
  }

  async function alternar(e: EntradaAgenda) {
    const antes = entradas
    setEntradas((xs) => xs.map((x) => (x.id === e.id ? { ...x, completado: !x.completado } : x)))
    const r = await marcarCompletado(e.id, !e.completado)
    if (r.error) { setEntradas(antes); toast.error("No se pudo guardar") }
  }

  async function borrar(e: EntradaAgenda) {
    const antes = entradas
    setEntradas((xs) => xs.filter((x) => x.id !== e.id))
    const r = await eliminarEntrada(e.id)
    if (r.error) { setEntradas(antes); toast.error("No se pudo borrar") }
  }

  const fechaLarga = new Date(diaSel + "T12:00:00").toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  })

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-4 w-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-foreground">Agenda del equipo</h2>
          {cargando && <span className="text-[11px] text-muted-foreground">actualizando…</span>}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && personas.length > 1 && (
            <select
              value={verDe}
              onChange={(e) => setVerDe(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-violet-500/60"
            >
              <option value="todos">Todo el equipo</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setAncla(new Date(ancla.getFullYear(), ancla.getMonth() - 1, 1))}
              className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium capitalize min-w-[7.5rem] text-center">
              {nombreMes(ancla)}
            </span>
            <button
              onClick={() => setAncla(new Date(ancla.getFullYear(), ancla.getMonth() + 1, 1))}
              className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Rejilla del mes */}
        <div className="p-3 lg:border-r border-border">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DIAS_SEMANA.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {semanas.flat().map((dia) => {
              const k = claveDia(dia)
              const delMes = dia.getMonth() === ancla.getMonth()
              const items = porDia[k] ?? []
              const pendientes = items.filter((i) => !i.completado)
              return (
                <button
                  key={k}
                  onClick={() => setDiaSel(k)}
                  // Alto fijo y no aspect-square: a ancho de escritorio una
                  // celda cuadrada mide noventa píxeles y las seis semanas se
                  // comen media pantalla para enseñar treinta números.
                  className={cn(
                    grande ? "h-14 rounded-md flex items-center justify-center gap-1 text-sm transition-colors" : "h-9 rounded-md flex items-center justify-center gap-1 text-xs transition-colors",
                    delMes ? "text-foreground" : "text-muted-foreground/30",
                    k === diaSel
                      ? "bg-violet-500/15 border border-violet-500/40"
                      : "border border-transparent hover:bg-muted/60",
                  )}
                >
                  <span className={cn("tabular-nums", esHoy(dia) && "font-bold text-violet-500")}>
                    {dia.getDate()}
                  </span>
                  {items.length > 0 && (
                    <span className="flex items-center gap-px">
                      {items.slice(0, 3).map((i) => (
                        <span
                          key={i.id}
                          className={cn(
                            "h-1 w-1 rounded-full",
                            tipoDe(i.tipo, tipos).punto,
                            i.completado && "opacity-30",
                          )}
                        />
                      ))}
                      {items.length > 3 && (
                        <span className="text-[8px] text-muted-foreground">+</span>
                      )}
                    </span>
                  )}
                  {pendientes.length === 0 && items.length > 0 && (
                    <span className="h-1 w-1 rounded-full bg-emerald-500/40" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* El día elegido */}
        <div className={cn("p-4 flex flex-col", grande ? "max-h-[32rem]" : "max-h-[19rem]")}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium capitalize">{fechaLarga}</p>
              <p className="text-[11px] text-muted-foreground">
                {delDia.length === 0
                  ? "Nada apuntado"
                  : `${delDia.length} ${delDia.length === 1 ? "entrada" : "entradas"}`}
              </p>
            </div>
            <button
              onClick={() => setAbriendo((v) => !v)}
              className={cn(
                "h-8 px-2.5 rounded-md border border-border text-xs flex items-center gap-1 transition-all shrink-0",
                abriendo ? "bg-muted/60" : "hover:bg-muted/60",
              )}
            >
              {abriendo ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {abriendo ? "Cerrar" : "Añadir"}
            </button>
          </div>

          {abriendo && (
            <FormularioEntrada
              dia={diaSel}
              personas={personas}
              yoId={yoId}
              isAdmin={isAdmin}
              tipos={tipos}
              onHecho={async () => { setAbriendo(false); await recargar() }}
            />
          )}

          <div className="flex-1 space-y-1.5 overflow-y-auto scrollbar-thin min-h-0 pr-0.5">
            {/* Antes decía "Ni citas ni recordatorios", que era enumerar a mano
                los tipos que había en 2025 y dejaba fuera la visita. */}
            {delDia.length === 0 && !abriendo && (
              <p className="text-xs text-muted-foreground/70 py-6 text-center">
                No hay nada apuntado para este día.
              </p>
            )}
            {delDia.map((e) => {
              const t = tipoDe(e.tipo, tipos)
              const mio = e.agente_id === yoId
              return (
                <div
                  key={e.id}
                  className={cn(
                    "group rounded-lg border border-border bg-background px-3 py-2.5 flex items-start gap-2.5",
                    e.completado && "opacity-55",
                  )}
                >
                  <button
                    onClick={() => alternar(e)}
                    className={cn(
                      "mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      e.completado
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-border hover:border-emerald-500",
                    )}
                    aria-label={e.completado ? "Marcar pendiente" : "Marcar hecho"}
                  >
                    {e.completado && <Check className="h-3 w-3" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.punto)} />
                      <span className={cn("text-sm", e.completado && "line-through")}>{e.titulo}</span>
                      {!e.todo_el_dia && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">{horaDe(e.fecha)}</span>
                      )}
                    </div>
                    {e.descripcion && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{e.descripcion}</p>
                    )}
                    {/* De quién es y quién la puso: sin esto, a un agente le
                        aparecen visitas sin saber de dónde salen.

                        El tipo se dice SIEMPRE, no sólo cuando no hay quien la
                        apuntó. Antes eran excluyentes, y con la visita como
                        tipo propio eso se notaba justo en el caso que pidió el
                        dueño: el administrador le pone una visita a un agente y
                        el agente leía "apuntado por Admin" sin más, con el tipo
                        reducido a un punto de color de un milímetro. */}
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {isAdmin && !mio && <>Para {nombreDe(e.agente_id)} · </>}
                      {t.etiqueta}
                      {e.creado_por && e.creado_por !== e.agente_id
                        && ` · apuntado por ${nombreDe(e.creado_por)}`}
                    </p>
                  </div>

                  <button
                    onClick={() => borrar(e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500 shrink-0"
                    aria-label="Borrar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function FormularioEntrada({
  dia, personas, yoId, isAdmin, tipos, onHecho,
}: {
  dia: string
  personas: PersonaAgenda[]
  yoId: string
  isAdmin: boolean
  /** Los del catálogo, en su orden. Nunca llega vacío: ver `tiposDesdeCatalogo`. */
  tipos: TipoAgenda[]
  onHecho: () => void
}) {
  const [titulo, setTitulo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  // Arranca en el primero del catálogo (hoy "Cita", orden 10) y no en el
  // literal "cita": si mañana el dueño archiva ese valor, el formulario se
  // abriría con un tipo que la base de datos ya no acepta y no dejaría guardar.
  const [tipo, setTipo] = useState<TipoEntrada>(() => tipos[0].valor)
  const [hora, setHora] = useState("10:00")
  const [todoElDia, setTodoElDia] = useState(false)
  const [para, setPara] = useState(yoId)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (!titulo.trim()) return toast.error("Ponle un título")
    setGuardando(true)
    const fecha = new Date(`${dia}T${todoElDia ? "00:00" : hora}:00`)
    const r = await crearEntrada({
      titulo, descripcion, tipo,
      fecha: fecha.toISOString(),
      todoElDia,
      agenteId: isAdmin ? para : undefined,
    })
    setGuardando(false)
    if (r.error) return toast.error(r.error)
    toast.success("Apuntado")
    setTitulo(""); setDescripcion("")
    onHecho()
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 mb-3">
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") guardar() }}
        placeholder="Visita en Calle Colón, 14"
        autoFocus
        className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-violet-500/60"
      />

      {/* Rejilla de dos columnas y no una fila de botones estirados: con la
          visita ya son cuatro tipos, y cuatro en fila dentro de la columna
          estrecha de la portada dejan "Recordatorio" en dos líneas o cortado.
          Dos columnas aguantan los cuatro de hoy y los que añada el dueño
          desde /configuracion/catalogos sin rehacer nada.

          El elegido se pinta con SU color, no en violeta para todos: el violeta
          era el de la cita, así que elegir "Visita" encendía un recuadro
          violeta encima de un punto verde. `claseColor` trae las clases de un
          mapa escrito entero —Tailwind purga lo que se arma con plantillas—. */}
      <div className="grid grid-cols-2 gap-1.5">
        {tipos.map((t) => (
          <button
            key={t.valor}
            onClick={() => setTipo(t.valor)}
            className={cn(
              "h-7 rounded-md border text-[11px] flex items-center justify-center gap-1 transition-colors",
              tipo === t.valor ? claseColor(t.color) : "border-border hover:bg-muted/60",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.punto)} />
            <span className="truncate">{t.etiqueta}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="time"
          value={hora}
          disabled={todoElDia}
          onChange={(e) => setHora(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-violet-500/60 disabled:opacity-40"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={todoElDia}
            onChange={(e) => setTodoElDia(e.target.checked)}
            className="accent-violet-500"
          />
          Todo el día
        </label>
      </div>

      {/* Sólo el admin elige destinatario. Un agente se apunta lo suyo y ya. */}
      {isAdmin && personas.length > 1 && (
        <select
          value={para}
          onChange={(e) => setPara(e.target.value)}
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-violet-500/60"
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === yoId ? `Para mí (${p.nombre})` : `Para ${p.nombre}`}
            </option>
          ))}
        </select>
      )}

      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Detalles (opcional)"
        rows={2}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-violet-500/60 resize-none"
      />

      <button
        onClick={guardar}
        disabled={guardando || !titulo.trim()}
        className="w-full h-8 rounded-md bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
      >
        {guardando ? "Guardando…" : "Apuntar"}
      </button>
    </div>
  )
}
