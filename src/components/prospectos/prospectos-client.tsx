"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Building2, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { getProspectos, getTotalesProspectos } from "@/lib/actions/prospectos"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import type { PersonaLinea } from "@/components/shared/linea-tiempo"
import {
  claseColor,
  clasePunto,
  colorDe,
  nombreDe,
  opcionesDe,
  type Catalogo,
} from "@/lib/catalogos"
import { ProspectoPanel } from "./prospecto-panel"
import {
  cuando,
  errorDe,
  euros,
  filasDe,
  nombreAgente,
  RELOJ,
  totalDe,
  type Prospecto,
} from "./comun"

/**
 * La lista de prospectos: los pisos que estamos captando de verdad.
 *
 * Un prospecto nace al promocionar una captación desde el Scraper, y desde ese
 * momento la ficha es nuestra y editable (migración 022). Esta pantalla enseña
 * lo que un comercial mira antes de coger el teléfono —dónde está, cuánto pide,
 * a quién se llama y quién lo lleva— y deja la ficha a un clic.
 */

const ESTADO_CAT = "estado_prospecto"

/** La clave del contador de "Todos": no es ningún estado del catálogo. */
const TODOS = ""

export default function ProspectosClient({
  catalogos,
  personas,
  yoId,
  isAdmin,
}: {
  catalogos: Catalogo[]
  /** El equipo, para poner nombre a quien captó y a quien lleva cada piso. */
  personas: PersonaLinea[]
  /** Quién soy y qué puedo. Lo resuelve el servidor con `sesionActual()`. */
  yoId: string
  isAdmin: boolean
}) {
  const [filas, setFilas] = useState<Prospecto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [estadoFiltro, setEstadoFiltro] = useState("")
  const [busqueda, setBusqueda] = useState("")
  const [pagina, setPagina] = useState(1)
  const [seleccionado, setSeleccionado] = useState<Prospecto | null>(null)

  /**
   * Cuántos hay en cada estado, contado EN LA BASE.
   *
   * `undefined` es "todavía no se ha contado" y `null` es "no se ha podido
   * contar": ninguno de los dos se pinta. Un 0 en una pastilla se lee como "aquí
   * no hay nada" y hace que nadie vuelva a mirar, así que un contador que falla
   * se queda sin número antes que mintiendo.
   */
  const [contadores, setContadores] = useState<Record<string, number | null>>({})

  /** Se sube al guardar algo para que lista y contadores se relean solos. */
  const [refresco, setRefresco] = useState(0)

  // null hasta que el componente está hidratado; ver RELOJ.
  const ahora = useSyncExternalStore<number | null>(
    RELOJ.subscribe,
    RELOJ.ahora,
    RELOJ.enServidor,
  )

  // Activos y en orden, tal y como los dejó el administrador en el panel. Hoy
  // son tres; los otros tres se encienden desde /configuracion/catalogos sin
  // desplegar nada, que es justo para lo que existe la tabla `catalogos`.
  const ESTADOS = useMemo(() => opcionesDe(catalogos, ESTADO_CAT), [catalogos])

  const nombreEstado = (e: string) => nombreDe(catalogos, ESTADO_CAT, e)
  const colorEstado = (e: string) => colorDe(catalogos, ESTADO_CAT, e)

  const termino = busqueda.trim()

  /** Número de la última carga pedida: sólo esa puede tocar el estado. */
  const peticionRef = useRef(0)

  /**
   * Trae UNA página de prospectos y, con ella, el total de verdad.
   *
   * El total sale contado en la base de datos, no de las filas traídas —que
   * dirían siempre cincuenta—, y una consulta que falla NO es una lista vacía:
   * enseñar "aún no hay prospectos" con la tabla llena es la peor manera posible
   * de equivocarse.
   */
  const cargar = useCallback(async (pag: number) => {
    // Dos cargas pueden estar en el aire a la vez: tecleas mientras vuelve la
    // anterior, o cambias de página. Sin esto, la respuesta lenta de "ruz" pinta
    // encima de la de "ruzafa" y acabas viendo una lista que no corresponde a lo
    // que pone el buscador.
    const peticion = ++peticionRef.current
    const vigente = () => peticion === peticionRef.current

    setCargando(true)
    const res = await getProspectos({
      estado: estadoFiltro || undefined,
      search: termino || undefined,
      pagina: pag,
      porPagina: POR_PAGINA,
    }).catch(() => ({ error: "No hay conexión con el servidor" }))

    if (!vigente()) return

    const problema = errorDe(res)
    if (problema) {
      setErrorCarga(problema)
      setFilas([])
      setTotal(0)
      setCargando(false)
      toast.error("No se han podido cargar los prospectos")
      return
    }

    const totalReal = totalDe(res) ?? 0
    // Al borrar o mover prospectos mientras miras una página alta, la página
    // pedida puede dejar de existir: se baja a la última que quede en vez de
    // enseñar un vacío que se lee como "se han perdido".
    const paginas = Math.max(1, Math.ceil(totalReal / POR_PAGINA))
    if (pag > paginas) {
      setErrorCarga(null)
      setCargando(false)
      setPagina(paginas)
      return
    }

    setFilas(filasDe(res))
    setTotal(totalReal)
    setErrorCarga(null)
    setCargando(false)
  }, [estadoFiltro, termino])

  // La carga de la página. El retardo es sólo para el buscador: cambiar de
  // pastilla o de página tiene que responder en el acto.
  useEffect(() => {
    const espera = termino ? 300 : 0
    const t = setTimeout(() => { void cargar(pagina) }, espera)
    return () => clearTimeout(t)
  }, [cargar, pagina, refresco, termino])

  /**
   * Los contadores de las pastillas.
   *
   * Los cuenta la base de datos con `head: true` —viajan los totales, ni una
   * fila— y son el embudo ENTERO: no se recortan con el buscador ni con la
   * pastilla elegida, porque lo que dicen es cuántos pisos hay en cada fase, no
   * cuántos caben en la pantalla. Por eso tampoco se repiden al pasar de página.
   */
  useEffect(() => {
    let vivo = true
    getTotalesProspectos()
      .then(({ total: todos, porEstado }) => {
        if (vivo) setContadores({ [TODOS]: todos, ...porEstado })
      })
      // Un recuento que falla se queda sin número, no en cero: las pastillas se
      // pintan igual y se sigue pudiendo filtrar con ellas.
      .catch(() => { if (vivo) setContadores({}) })
    return () => { vivo = false }
  }, [refresco])

  // Al cambiar de página la lista vuelve arriba; si no, aterrizas en mitad de
  // la página nueva.
  const listaRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listaRef.current?.scrollTo({ top: 0 }) }, [pagina])

  /** Cualquier filtro nuevo vuelve a la página 1: en la 9 no habría nada. */
  function filtrarPor(estado: string) {
    setEstadoFiltro(estado)
    setPagina(1)
  }

  function buscar(texto: string) {
    setBusqueda(texto)
    setPagina(1)
  }

  /**
   * La ficha ha cambiado: se pinta en la tarjeta sin recargar la lista.
   *
   * Sin esto, corregir el precio o mover el estado desde el panel dejaba la fila
   * de la izquierda enseñando lo viejo hasta recargar la página entera.
   */
  function alActualizar(p: Prospecto) {
    setFilas((prev) => prev.map((f) => (f.id === p.id ? { ...f, ...p } : f)))
    setSeleccionado((prev) => (prev && prev.id === p.id ? { ...prev, ...p } : prev))
    // El estado puede haberse movido, así que las pastillas ya no cuadran.
    setRefresco((n) => n + 1)
  }

  const hayFiltros = Boolean(termino || estadoFiltro)

  /** El número de una pastilla, o nada si no se ha podido contar. */
  function contador(clave: string) {
    const n = contadores[clave]
    return typeof n === "number" ? n.toLocaleString("es") : null
  }

  return (
    <div className="flex h-full overflow-hidden p-7 gap-5">

      <div className="flex-1 flex flex-col min-w-0 gap-5 overflow-hidden">

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 shrink-0">
          <div className="flex flex-col gap-1">
            {/* El agente ve su cartera y el administrador la de todos: lo decide
                la acción en el servidor, así que el título lo dice también. */}
            <h1 className="text-xl font-semibold text-foreground">
              {isAdmin ? "Prospectos" : "Mis prospectos"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {cargando
                ? "Cargando..."
                : errorCarga
                  ? "No se ha podido cargar la lista"
                  : `${total.toLocaleString("es")} ${total === 1 ? "piso en captación" : "pisos en captación"}`}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por dirección o barrio..."
              value={busqueda}
              onChange={(e) => buscar(e.target.value)}
              className="pl-8 pr-3 h-9 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-64"
            />
          </div>
        </div>

        {/* Pastillas de estado. Salen del catálogo: ninguna está escrita aquí,
            así que encender "Valorando" desde /configuracion/catalogos la hace
            aparecer sin desplegar nada. */}
        <div className="flex items-center gap-2 overflow-x-auto shrink-0">
          <button
            onClick={() => filtrarPor(TODOS)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
              estadoFiltro === TODOS
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            Todos
            {contador(TODOS) && <span className="tabular-nums opacity-70">{contador(TODOS)}</span>}
          </button>

          {ESTADOS.map(({ valor, nombre, color }) => (
            <button
              key={valor}
              onClick={() => filtrarPor(estadoFiltro === valor ? TODOS : valor)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
                estadoFiltro === valor
                  ? claseColor(color)
                  : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(color))} />
              {nombre}
              {contador(valor) && <span className="tabular-nums opacity-70">{contador(valor)}</span>}
            </button>
          ))}
        </div>

        {/* La lista */}
        <div
          ref={listaRef}
          className="flex-1 rounded-xl border border-border bg-card overflow-auto scrollbar-thin"
        >
          {cargando && filas.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando prospectos...</div>
          ) : errorCarga ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">No se han podido cargar los prospectos</p>
                <p className="text-xs text-muted-foreground">{errorCarga}</p>
              </div>
              <button
                onClick={() => setRefresco((n) => n + 1)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reintentar
              </button>
            </div>
          ) : filas.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Building2 className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1.5 max-w-sm">
                <p className="text-sm font-medium text-foreground">
                  {hayFiltros ? "No hay prospectos con estos filtros" : "Todavía no hay ningún prospecto"}
                </p>
                {/* Un "no hay nada" a secas deja a quien entra sin saber qué
                    hacer. Los prospectos no se crean aquí: nacen al promocionar
                    una captación desde el Scraper, cuando el propietario dice
                    que sí y el anuncio ajeno pasa a ser un piso nuestro. */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {hayFiltros
                    ? "Prueba con otro estado o borra la búsqueda."
                    : "Un prospecto nace en el Scraper: abre la captación de un propietario que ya ha dicho que sí y pulsa «Pasar a prospecto». Desde ese momento la ficha del piso es nuestra y se puede corregir aquí."}
                </p>
              </div>
              {!hayFiltros && (
                <Link
                  href="/captaciones"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Ir al Scraper
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          ) : (
            // La tabla puede ser más ancha que el panel: el scroll horizontal es
            // de la caja de arriba, no de la página.
            <table className="w-full min-w-[62rem] border-collapse">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-left">
                  {["Dirección", "Barrio", "Precio", "Salida", "Propietario", "Lo captó", "Lo lleva", "Estado", "Atendido"].map((c) => (
                    <th
                      key={c}
                      className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filas.map((p) => (
                  // Fila y no botón: dentro va el teléfono como enlace `tel:`, y
                  // un enlace dentro de un botón no es HTML válido.
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => setSeleccionado(seleccionado?.id === p.id ? null : p)}
                    onKeyDown={(e) => {
                      // Sólo cuando el foco está en la FILA. Con el foco en el
                      // enlace del teléfono, el preventDefault de aquí cancelaba
                      // la activación del enlace: quien navega con el teclado
                      // pulsaba Enter para llamar y lo que se abría era la ficha.
                      // El clic ya se protege con stopPropagation; esto es lo
                      // mismo para el teclado.
                      if (e.target !== e.currentTarget) return
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSeleccionado(seleccionado?.id === p.id ? null : p)
                      }
                    }}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40 focus:outline-none focus:bg-muted/40",
                      seleccionado?.id === p.id && "bg-muted/60",
                    )}
                  >
                    <td className="px-4 py-3 text-sm text-foreground max-w-[16rem]">
                      <span className="block truncate" title={p.direccion ?? undefined}>
                        {p.direccion ?? "Sin dirección"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {p.barrio ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground tabular-nums whitespace-nowrap">
                      {euros(p.precio)}
                    </td>
                    {/* El precio de salida es el que se acuerda para publicar, y
                        no tiene por qué ser el que pide el propietario: es la
                        distancia entre los dos la que dice si el piso sale. */}
                    <td className="px-4 py-3 text-sm tabular-nums whitespace-nowrap text-muted-foreground">
                      {euros(p.precio_salida)}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[13rem]">
                      <span className="block text-foreground truncate">
                        {p.contacto_nombre ?? "Sin nombre"}
                      </span>
                      {p.contacto_telefono ? (
                        <a
                          href={`tel:${p.contacto_telefono}`}
                          // La fila entera abre la ficha: sin esto, llamar la
                          // abriría también y el panel taparía la pantalla justo
                          // al descolgar.
                          onClick={(e) => e.stopPropagation()}
                          className="text-violet-500 hover:text-violet-400 transition-colors"
                        >
                          {p.contacto_telefono}
                        </a>
                      ) : (
                        <span className="text-muted-foreground/60 italic">Sin teléfono</span>
                      )}
                    </td>
                    {/* Dos personas y no una: quien lo trajo no cambia porque hoy
                        lo lleve otro, y media razón de que los prospectos sean
                        una tabla aparte es poder decir las dos cosas. */}
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[9rem]">
                      <span className="block truncate">{nombreAgente(personas, p.captado_por)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[9rem]">
                      <span
                        className={cn(
                          "block truncate",
                          p.agente_id ? "text-foreground" : "text-amber-600 dark:text-amber-300",
                        )}
                      >
                        {nombreAgente(personas, p.agente_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border font-medium",
                          claseColor(colorEstado(p.estado)),
                        )}
                      >
                        {nombreEstado(p.estado)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {cuando(p.atendido_en, ahora)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Paginador
          pagina={pagina}
          porPagina={POR_PAGINA}
          total={total}
          onCambiar={setPagina}
          cargando={cargando}
          className="shrink-0"
        />
      </div>

      {seleccionado && (
        <ProspectoPanel
          // El panel no se desmonta al pasar de un prospecto a otro: el `key`
          // deja que cada ficha empiece con su propio formulario en vez de
          // heredar lo que se estuviera tecleando en la anterior.
          key={seleccionado.id}
          prospecto={seleccionado}
          catalogos={catalogos}
          personas={personas}
          yoId={yoId}
          isAdmin={isAdmin}
          onCerrar={() => setSeleccionado(null)}
          onActualizado={alActualizar}
        />
      )}
    </div>
  )
}
