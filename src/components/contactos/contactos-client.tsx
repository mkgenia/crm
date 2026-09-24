"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Contact, RefreshCw, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getContactos, getTotalesContactos, type FilaContacto } from "@/lib/actions/contactos"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import type { PersonaLinea } from "@/components/shared/linea-tiempo"
import { claseColor, colorDe, nombreDe, type Catalogo } from "@/lib/catalogos"
// Los euros, el reloj y el "hace 3 días" son los mismos que usa la lista de
// prospectos, y se leen del mismo sitio a propósito: dos copias de `cuando()`
// acabarían diciendo cosas distintas sobre la misma fecha.
import { cuando, errorDe, euros, nombreAgente, RELOJ } from "@/components/prospectos/comun"

/**
 * La lista de contactos: las PERSONAS de la agencia.
 *
 * Un contacto es un lead que ya ha dado el paso —hoy, que su captación saltó a
 * prospecto—, así que esta pantalla no crea nada ni tiene botón de "nuevo": se
 * llega a ella trabajando. Lo que enseña es lo que se mira antes de llamar a
 * alguien: quién es, por dónde entró, qué pisos suyos llevamos y quién lo
 * atiende.
 */

/** Cómo se lee una fila cruda de la acción, sin romperse por lo que falte. */
function aFila(cruda: unknown): FilaContacto | null {
  if (!cruda || typeof cruda !== "object") return null
  const f = cruda as Record<string, unknown>
  if (typeof f.id !== "string") return null
  const lista = Array.isArray(f.prospectos) ? f.prospectos : []
  return {
    ...(f as unknown as FilaContacto),
    prospectos: lista as FilaContacto["prospectos"],
  }
}

export default function ContactosClient({
  catalogos,
  personas,
  isAdmin,
}: {
  catalogos: Catalogo[]
  personas: PersonaLinea[]
  isAdmin: boolean
}) {
  const [filas, setFilas] = useState<FilaContacto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [conPiso, setConPiso] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [pagina, setPagina] = useState(1)
  const [abierto, setAbierto] = useState<FilaContacto | null>(null)
  const [contadores, setContadores] = useState<{ total: number | null; conPiso: number | null }>({
    total: null,
    conPiso: null,
  })
  const [refresco, setRefresco] = useState(0)

  // null hasta que el componente está hidratado; ver RELOJ.
  const ahora = useSyncExternalStore<number | null>(RELOJ.subscribe, RELOJ.ahora, RELOJ.enServidor)

  const termino = busqueda.trim()
  const peticionRef = useRef(0)
  const listaRef = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async (pag: number) => {
    // Dos cargas pueden estar en el aire a la vez —se teclea mientras vuelve la
    // anterior—: sin esto, la respuesta lenta pinta encima de la nueva.
    const peticion = ++peticionRef.current
    const vigente = () => peticion === peticionRef.current

    setCargando(true)
    const res = await getContactos({
      search: termino || undefined,
      conPiso: conPiso || undefined,
      pagina: pag,
      porPagina: POR_PAGINA,
    }).catch(() => ({ error: "No hay conexión con el servidor" }))

    if (!vigente()) return

    const problema = errorDe(res)
    if (problema) {
      setErrorCarga(problema)
      setFilas([])
      setCargando(false)
      return
    }

    const crudas = (res as { filas?: unknown[] }).filas ?? []
    setErrorCarga(null)
    setFilas(crudas.map(aFila).filter((f): f is FilaContacto => f !== null))
    setTotal((res as { total?: number }).total ?? 0)
    setCargando(false)
  }, [termino, conPiso])

  // El retardo es sólo para el buscador: cambiar de pastilla o de página tiene
  // que responder en el acto. Y de paso la carga sale del cuerpo del efecto,
  // que es lo que pide React para no encadenar renders.
  useEffect(() => {
    const espera = termino ? 300 : 0
    const t = setTimeout(() => { void cargar(pagina) }, espera)
    return () => clearTimeout(t)
  }, [cargar, pagina, refresco, termino])

  useEffect(() => {
    void getTotalesContactos()
      .then(setContadores)
      // Un contador que no se puede leer se queda sin número, no a cero.
      .catch(() => setContadores({ total: null, conPiso: null }))
  }, [refresco])

  // Al cambiar de página, la lista vuelve arriba: quedarse a media altura sobre
  // filas nuevas es lo que hace pensar que no ha pasado nada.
  useEffect(() => { listaRef.current?.scrollTo({ top: 0 }) }, [pagina])

  const nombreEstado = (e: string | null) => (e ? nombreDe(catalogos, "estado_lead", e) : "—")
  const colorEstado = (e: string | null) => (e ? colorDe(catalogos, "estado_lead", e) : null)

  const hayFiltros = Boolean(termino || conPiso)

  function buscar(v: string) {
    setBusqueda(v)
    setPagina(1)
  }

  const nombreCompleto = (c: FilaContacto) =>
    [c.nombre, c.apellidos].filter(Boolean).join(" ").trim() || "Sin nombre"

  return (
    <div className="flex h-full overflow-hidden p-7 gap-5">
      <div className="flex-1 flex flex-col min-w-0 gap-5 overflow-hidden">

        <div className="flex items-start justify-between gap-3 shrink-0">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-foreground">
              {isAdmin ? "Contactos" : "Mis contactos"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {cargando
                ? "Cargando..."
                : errorCarga
                  ? "No se ha podido cargar la lista"
                  : `${total.toLocaleString("es")} ${total === 1 ? "persona" : "personas"}`}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre, teléfono o email..."
              value={busqueda}
              onChange={(e) => buscar(e.target.value)}
              className="pl-8 pr-3 h-9 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-72"
            />
          </div>
        </div>

        {/* Dos pastillas y no siete: aquí no hay embudo que filtrar. Lo único
            que separa a una persona de otra en esta lista es si ya llevamos un
            piso suyo. */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setConPiso(false); setPagina(1) }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
              !conPiso
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            Todos
            {typeof contadores.total === "number" && (
              <span className="tabular-nums opacity-70">{contadores.total.toLocaleString("es")}</span>
            )}
          </button>
          <button
            onClick={() => { setConPiso(true); setPagina(1) }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
              conPiso
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            Con piso en captación
            {typeof contadores.conPiso === "number" && (
              <span className="tabular-nums opacity-70">{contadores.conPiso.toLocaleString("es")}</span>
            )}
          </button>
        </div>

        <div
          ref={listaRef}
          className="flex-1 rounded-xl border border-border bg-card overflow-auto scrollbar-thin"
        >
          {cargando && filas.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando contactos...</div>
          ) : errorCarga ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">No se han podido cargar los contactos</p>
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
                <Contact className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1.5 max-w-sm">
                <p className="text-sm font-medium text-foreground">
                  {hayFiltros ? "Nadie con esa búsqueda" : "Todavía no hay contactos"}
                </p>
                {/* Los contactos no se crean aquí: se llega a serlo. Decirlo
                    evita que alguien busque un botón que no existe. */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {hayFiltros
                    ? "Prueba con otro nombre o borra la búsqueda."
                    : "Una persona pasa a contacto sola, cuando su captación se convierte en prospecto."}
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
            <table className="w-full min-w-[58rem] border-collapse">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-left">
                  {["Persona", "Entró por", "Pisos suyos", "Lo lleva", "Contacto desde", "Estado"].map((c) => (
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
                {filas.map((c) => (
                  // Fila y no botón: dentro va el teléfono como enlace `tel:`, y
                  // un enlace dentro de un botón no es HTML válido.
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setAbierto(abierto?.id === c.id ? null : c)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setAbierto(abierto?.id === c.id ? null : c)
                      }
                    }}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40 focus:outline-none focus:bg-muted/40",
                      abierto?.id === c.id && "bg-muted/60",
                    )}
                  >
                    <td className="px-4 py-3 text-sm max-w-[18rem]">
                      <span className="block text-foreground truncate">{nombreCompleto(c)}</span>
                      {c.telefono ? (
                        <a
                          href={`tel:${c.telefono}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-violet-500 hover:text-violet-400 transition-colors"
                        >
                          {c.telefono}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">Sin teléfono</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {c.fuente ?? "—"}
                    </td>
                    {/* El número de pisos, no la lista: la lista está en la
                        ficha, y aquí lo que se busca es "¿tiene algo con
                        nosotros?". */}
                    <td className="px-4 py-3 text-sm text-foreground tabular-nums whitespace-nowrap">
                      {c.prospectos.length || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[10rem]">
                      <span
                        className={cn(
                          "block truncate",
                          c.agente_id ? "text-foreground" : "text-amber-600 dark:text-amber-300",
                        )}
                      >
                        {nombreAgente(personas, c.agente_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {cuando(c.contacto_desde, ahora)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border font-medium",
                          claseColor(colorEstado(c.estado)),
                        )}
                      >
                        {nombreEstado(c.estado)}
                      </span>
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

      {abierto && (
        <aside className="w-[22rem] shrink-0 rounded-xl border border-border bg-card overflow-auto scrollbar-thin">
          <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground truncate">{nombreCompleto(abierto)}</p>
              <p className="text-xs text-muted-foreground">
                Contacto desde {cuando(abierto.contacto_desde, ahora)}
              </p>
            </div>
            <button
              onClick={() => setAbierto(null)}
              aria-label="Cerrar"
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contacto</p>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Teléfono</span>
                {abierto.telefono ? (
                  <a href={`tel:${abierto.telefono}`} className="text-violet-500 hover:text-violet-400">
                    {abierto.telefono}
                  </a>
                ) : (
                  <span className="text-muted-foreground/60 italic">—</span>
                )}
              </div>
              {/* El correo entero y seleccionable. En la ficha del lead se corta
                  con puntos suspensivos y no hay forma de copiarlo. */}
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="text-muted-foreground shrink-0">Email</span>
                <span className="text-foreground text-right break-all select-all">
                  {abierto.email ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Entró por</span>
                <span className="text-foreground">{abierto.fuente ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Lo lleva</span>
                <span className="text-foreground">{nombreAgente(personas, abierto.agente_id)}</span>
              </div>
            </div>

            {/* SUS PISOS. Es lo que esta pantalla añade a la del lead: la
                persona con lo que tiene con nosotros, en el mismo sitio. */}
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pisos suyos
              </p>
              {abierto.prospectos.length === 0 ? (
                <p className="text-xs text-muted-foreground/70">Ninguno todavía.</p>
              ) : (
                abierto.prospectos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/prospectos?p=${p.id}`}
                    className="rounded-lg border border-border px-3 py-2.5 flex flex-col gap-0.5 hover:border-muted-foreground/40 transition-colors"
                  >
                    <span className="text-sm text-foreground truncate">{p.direccion ?? "Sin dirección"}</span>
                    <span className="text-xs text-muted-foreground">
                      {[p.barrio, euros(p.precio)].filter(Boolean).join(" · ")}
                    </span>
                  </Link>
                ))
              )}
            </div>

            {abierto.captacion_id !== null && (
              <Link
                href={`/captaciones?id=${abierto.captacion_id}`}
                className="text-xs text-violet-500 hover:text-violet-400"
              >
                Ver la captación de la que vino
              </Link>
            )}

            <Link
              href={`/leads?lead=${abierto.id}`}
              className="flex items-center justify-center gap-1.5 h-9 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
            >
              Abrir su ficha de lead
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            {abierto.notas && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notas</p>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{abierto.notas}</p>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
