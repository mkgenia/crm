"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { actualizarPropiedad, desactivarPropiedad, eliminarDemanda, eliminarPropiedad } from "@/lib/actions/demandas"
import { Search, X, Building2, Pencil, Check, Loader2, Trash2, Phone, Mail } from "lucide-react"
import { toast } from "sonner"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import { traerTodo } from "@/lib/supabase/paginar"
import { cn } from "@/lib/utils"
import { ESTADOS_DEMANDA, ESTADO_DEMANDA_CFG, FUENTE_CFG } from "@/types/demandas"
import type { Demanda, PropiedadDemanda, EstadoDemanda } from "@/types/demandas"

interface PropiedadConConteos extends PropiedadDemanda {
  totalDemandas: number
  noVistas: number
}

/** Lo que devuelve la consulta: la propiedad más el agregado `demandas(count)`. */
type FilaPropiedad = PropiedadDemanda & { demandas?: { count: number }[] | null }

/**
 * El filtro `or` de PostgREST se escribe como una lista separada por comas
 * dentro de paréntesis, así que una coma o un paréntesis tecleados en la caja de
 * búsqueda parten la consulta por la mitad y devuelven un 400. `*` y `%` son
 * comodines de `ilike` y harían que "Sant%" trajese cosas que nadie pidió.
 */
function limpiarBusqueda(valor: string) {
  return valor.trim().replace(/[,()*%\\"]/g, "").trim()
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return new Date(date).toLocaleDateString("es", { day: "numeric", month: "short" })
}

function fmtPrecio(alq: number, venta: number) {
  if (alq > 0) return `${alq.toLocaleString("es-ES")} €/mes`
  if (venta > 0) return `${venta.toLocaleString("es-ES")} €`
  return null
}

export default function DemandasPage() {
  const [propiedades, setPropiedades] = useState<PropiedadConConteos[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  /** Lo que se ha buscado de verdad, ya con el rebote aplicado. */
  const [termino, setTermino] = useState("")
  const [pagina, setPagina] = useState(1)
  /** Propiedades que cumplen el filtro, contadas en la base de datos. */
  const [total, setTotal] = useState(0)
  /** null = todavía no se sabe; un 0 inventado diría que no hay demandas. */
  const [totalDemandas, setTotalDemandas] = useState<number | null>(null)
  const [selected, setSelected] = useState<PropiedadConConteos | null>(null)
  const [demandas, setDemandas] = useState<Demanda[]>([])
  const [loadingDemandas, setLoadingDemandas] = useState(false)

  // Edit propiedad
  const [editando, setEditando] = useState(false)
  const [editFields, setEditFields] = useState<Partial<PropiedadDemanda>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  // Edit demand notes
  const [editingDemandId, setEditingDemandId] = useState<string | null>(null)
  const [editNotas, setEditNotas] = useState("")
  const [savingNota, setSavingNota] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const supabase = createClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listaRef = useRef<HTMLDivElement | null>(null)
  const peticionRef = useRef(0)
  const selectedRef = useRef<PropiedadConConteos | null>(null)
  selectedRef.current = selected

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  /** La página pedida ya no existe; el efecto de abajo está devolviendo a la última. */
  const fueraDeRango = pagina > paginas

  const fetchPropiedades = useCallback(async (pagina: number, termino: string) => {
    // Cada petición se queda con su número. Si mientras va y viene se teclea otra
    // búsqueda o se cambia de página, la que llega tarde se descarta: si no, la
    // respuesta vieja pinta filas que no son las de la página que marca el
    // paginador, y eso es peor que no enseñar nada.
    const peticion = ++peticionRef.current
    setLoading(true)
    try {
      const desde = (pagina - 1) * POR_PAGINA

      // `demandas(count)` deja que Postgres cuente las demandas de cada
      // propiedad. Antes se traían las filas enteras sólo para hacerles un
      // .length, y son esas las que reventaban el tope: 1.825 demandas viajando
      // para pintar un "89 demandas" en un lateral.
      let q = supabase
        .from("propiedades_demanda")
        .select("*, demandas(count)", { count: "exact" })
        .eq("activo", true)

      const t = limpiarBusqueda(termino)
      if (t) q = q.or(`ref.ilike.%${t}%,ciudad.ilike.%${t}%,zona.ilike.%${t}%,tipo.ilike.%${t}%`)

      // El id desempata el orden. Con updated_at a secas, dos propiedades con la
      // misma marca de tiempo pueden intercambiarse entre una petición y la
      // siguiente, y entonces una sale dos veces y otra no sale en ninguna.
      const { data, count, error } = await q
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(desde, desde + POR_PAGINA - 1)

      if (peticion !== peticionRef.current) return

      if (error) {
        toast.error("No se pudieron cargar las propiedades")
        return
      }

      const filas = (data ?? []) as FilaPropiedad[]

      // Las no vistas van aparte porque en el mismo select harían falta dos
      // agregados de la misma tabla y uno de ellos filtrado. Aquí sí hacen falta
      // las filas para agruparlas, y aunque sean las de 50 propiedades pueden
      // pasar del tope de 1.000 después de un puente: traerTodo pagina hasta
      // agotarlas. El orden por id es lo que impide que ese paginado repita o se
      // salte filas y descuadre el recuento.
      const pendientes = new Map<string, number>()
      if (filas.length) {
        const ids = filas.map((p) => p.id)
        const sinVer = await traerTodo<{ propiedad_id: string }>(() =>
          supabase
            .from("demandas")
            .select("propiedad_id")
            .in("propiedad_id", ids)
            .eq("visto", false)
            .order("id", { ascending: true })
        )
        for (const d of sinVer) {
          pendientes.set(d.propiedad_id, (pendientes.get(d.propiedad_id) ?? 0) + 1)
        }
        if (peticion !== peticionRef.current) return
      }

      setPropiedades(filas.map((p) => {
        const { demandas: agregado, ...rest } = p
        return {
          ...rest,
          extras: rest.extras ?? [],
          totalDemandas: agregado?.[0]?.count ?? 0,
          noVistas: pendientes.get(p.id) ?? 0,
        }
      }))
      setTotal(count ?? 0)
    } finally {
      // Sólo la última petición apaga el indicador: si lo apagase la que llega
      // tarde, la lista se daría por cargada mientras la buena sigue en camino.
      if (peticion === peticionRef.current) setLoading(false)
    }
  }, [])

  const fetchTotalDemandas = useCallback(async () => {
    // head:true trae sólo la cabecera con el total: la cabecera de la página
    // tiene que decir 1.825 aunque en pantalla haya 50 propiedades, y sumar lo
    // que se ve daría un número más pequeño cada vez que pasas de página.
    const { count, error } = await supabase.from("demandas").select("id", { count: "exact", head: true })
    // Si falla se deja en null y la cabecera no menciona las demandas. Poner un 0
    // sería decir que no hay ninguna, que es justo la clase de mentira silenciosa
    // que vinimos a quitar.
    if (error || count === null) return
    setTotalDemandas(count)
  }, [])

  const fetchDemandas = useCallback(async (propiedadId: string) => {
    setLoadingDemandas(true)
    // Esta lista no se pagina: la propiedad más solicitada anda por las 90
    // demandas y caben de sobra. El count está para que el día que deje de ser
    // verdad se vea — PostgREST recorta en 1.000 devolviendo 200 OK.
    const { data, count, error } = await supabase
      .from("demandas")
      .select("*", { count: "exact" })
      .eq("propiedad_id", propiedadId)
      .order("fecha_creacion", { ascending: false })
    if (error) {
      // Sin esto, un fallo de red dejaba el panel con el vacío de "sin demandas"
      // en una propiedad que sí las tiene.
      toast.error("No se pudieron cargar las demandas de esta propiedad")
      setDemandas([])
      setLoadingDemandas(false)
      return
    }
    const filas = (data ?? []) as Demanda[]
    if (count !== null && count > filas.length) {
      toast.warning(`Esta propiedad tiene ${count} demandas y sólo se han podido cargar ${filas.length}`)
    }
    setDemandas(filas)
    setLoadingDemandas(false)

    // Marcar como vistas
    await supabase.from("demandas").update({ visto: true }).eq("propiedad_id", propiedadId).eq("visto", false)
    setPropiedades((prev) => prev.map((p) => p.id === propiedadId ? { ...p, noVistas: 0 } : p))
  }, [])

  useEffect(() => {
    fetchTotalDemandas()

    const channel = supabase
      .channel("demandas-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demandas" }, (payload) => {
        const nueva = payload.new as any
        // Si la propiedad está en la página que se ve, se le suma la demanda. Si
        // no está, no se recarga nada: recargar movería la lista bajo los pies
        // de quien la esté leyendo, y el aviso ya sale por el toast.
        setPropiedades((prev) =>
          prev.map((p) =>
            p.id === nueva.propiedad_id
              ? { ...p, totalDemandas: p.totalDemandas + 1, noVistas: p.noVistas + 1 }
              : p
          )
        )
        setTotalDemandas((n) => (n === null ? n : n + 1))
        if (selectedRef.current?.id === nueva.propiedad_id) {
          setDemandas((prev) => [nueva as Demanda, ...prev])
        }
        toast("Nueva demanda recibida", {
          description: `${nueva.nombre ?? "Sin nombre"} · ${nueva.fuente ?? "Portal"}`,
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchTotalDemandas])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // Se guarda ya limpio: si sólo se teclean caracteres que hay que quitar, el
      // término queda vacío y la pantalla no dice "sin resultados" de una
      // búsqueda que en realidad no se ha llegado a filtrar.
      setTermino(limpiarBusqueda(search))
      // Volver a la 1 al cambiar la búsqueda: si estás en la página 9 y filtras
      // por algo con 20 resultados, te quedas mirando una página vacía.
      setPagina(1)
    }, search ? 300 : 0)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  useEffect(() => {
    fetchPropiedades(pagina, termino)
    // Al cambiar de página se vuelve arriba: si no, aterrizas a media lista
    // sobre filas que no son las que estabas mirando.
    listaRef.current?.scrollTo({ top: 0 })
  }, [pagina, termino, fetchPropiedades])

  // Borrar o desactivar puede dejar la página actual fuera de rango: estabas en
  // la 2 con 51 propiedades, quitas una y quedan 50, o sea una sola página. Sin
  // esto te quedas mirando una lista vacía con medio centenar de fichas detrás,
  // que es la misma sensación de "faltan datos" que veníamos a arreglar.
  useEffect(() => {
    if (pagina > paginas) setPagina(paginas)
  }, [pagina, paginas])

  function selectPropiedad(p: PropiedadConConteos) {
    if (selected?.id === p.id) {
      setSelected(null)
      setDemandas([])
      setEditando(false)
      return
    }
    setSelected(p)
    setEditando(false)
    fetchDemandas(p.id)
  }

  function abrirEdicion() {
    if (!selected) return
    setEditFields({
      tipo:            selected.tipo            ?? "",
      accion:          selected.accion          ?? "",
      ciudad:          selected.ciudad          ?? "",
      zona:            selected.zona            ?? "",
      precio_alquiler: selected.precio_alquiler,
      precio_venta:    selected.precio_venta,
      habitaciones:    selected.habitaciones,
      banyos:          selected.banyos,
      m_construidos:   selected.m_construidos,
    })
    setEditando(true)
  }

  async function guardarEdicion() {
    if (!selected) return
    setSavingEdit(true)
    const res = await actualizarPropiedad(selected.id, {
      tipo:            String(editFields.tipo    ?? "").trim() || undefined,
      accion:          String(editFields.accion  ?? "").trim() || undefined,
      ciudad:          String(editFields.ciudad  ?? "").trim() || undefined,
      zona:            String(editFields.zona    ?? "").trim() || undefined,
      precio_alquiler: Number(editFields.precio_alquiler) || 0,
      precio_venta:    Number(editFields.precio_venta)    || 0,
      habitaciones:    Number(editFields.habitaciones)    || 0,
      banyos:          Number(editFields.banyos)          || 0,
      m_construidos:   Number(editFields.m_construidos)   || 0,
    })
    setSavingEdit(false)
    if (res.error) { toast.error(res.error); return }
    const updated = { ...selected, ...editFields } as PropiedadConConteos
    setSelected(updated)
    setPropiedades((prev) => prev.map((p) => p.id === selected.id ? updated : p))
    setEditando(false)
    toast.success("Propiedad actualizada")
  }

  async function cambiarEstado(demandaId: string, nuevoEstado: EstadoDemanda) {
    await supabase.from("demandas").update({ estado: nuevoEstado }).eq("id", demandaId)
    setDemandas((prev) => prev.map((d) => d.id === demandaId ? { ...d, estado: nuevoEstado } : d))
  }

  async function handleDesactivar() {
    if (!selected) return
    if (!window.confirm(`¿Desactivar la propiedad Ref. ${selected.ref}? Desaparecerá de la lista.`)) return
    const res = await desactivarPropiedad(selected.id)
    if (res.error) { toast.error(res.error); return }
    setPropiedades((prev) => prev.filter((p) => p.id !== selected.id))
    // El total es el que cuenta la base de datos, así que al quitar una fila hay
    // que bajarlo a mano o el paginador seguiría prometiendo una propiedad que
    // ya no está.
    setTotal((n) => Math.max(0, n - 1))
    setSelected(null)
    toast.success("Propiedad desactivada")
  }

  async function handleEliminarPropiedad() {
    if (!selected) return
    if (!window.confirm(`¿Eliminar permanentemente la propiedad Ref. ${selected.ref} y todas sus demandas? Esta acción no se puede deshacer.`)) return
    const res = await eliminarPropiedad(selected.id)
    if (res.error) { toast.error(res.error); return }
    setPropiedades((prev) => prev.filter((p) => p.id !== selected.id))
    setTotal((n) => Math.max(0, n - 1))
    setTotalDemandas((n) => (n === null ? n : Math.max(0, n - selected.totalDemandas)))
    setSelected(null)
    setDemandas([])
    toast.success("Propiedad eliminada")
  }

  async function handleEliminarDemanda(demandaId: string) {
    setDeletingId(demandaId)
    const res = await eliminarDemanda(demandaId)
    setDeletingId(null)
    if (res.error) { toast.error(res.error); return }
    setDemandas((prev) => prev.filter((d) => d.id !== demandaId))
    setTotalDemandas((n) => (n === null ? n : Math.max(0, n - 1)))
    if (selected) {
      setPropiedades((prev) =>
        prev.map((p) => p.id === selected.id ? { ...p, totalDemandas: Math.max(0, p.totalDemandas - 1) } : p)
      )
    }
  }

  async function guardarNotas(demandaId: string) {
    setSavingNota(true)
    const val = editNotas.trim() || null
    await supabase.from("demandas").update({ notas: val }).eq("id", demandaId)
    setDemandas((prev) => prev.map((d) => d.id === demandaId ? { ...d, notas: val } : d))
    setSavingNota(false)
    setEditingDemandId(null)
  }

  const resumen = termino
    ? `${total.toLocaleString("es")} propiedad${total !== 1 ? "es" : ""} encontrada${total !== 1 ? "s" : ""}`
    : totalDemandas === null
      ? `${total.toLocaleString("es")} propiedades`
      : `${total.toLocaleString("es")} propiedades · ${totalDemandas.toLocaleString("es")} demanda${totalDemandas !== 1 ? "s" : ""}`

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: property list ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-8 pb-0 shrink-0 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">Demandas</h1>
              <p className="text-sm text-muted-foreground tabular-nums">
                {loading || fueraDeRango ? "Cargando..." : resumen}
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Ref, ciudad, zona..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 h-9 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-52"
              />
            </div>
          </div>
          <div className="border-b border-border" />
        </div>

        <div ref={listaRef} className="flex-1 overflow-y-auto">
          {loading || fueraDeRango ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : propiedades.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Building2 className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  {termino ? "Sin resultados" : "Sin demandas todavía"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {termino
                    ? "Prueba con otro término"
                    : "Las demandas llegan automáticamente desde los portales vía email"}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {propiedades.map((p) => {
                const precio = fmtPrecio(p.precio_alquiler, p.precio_venta)
                const active = selected?.id === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => selectPropiedad(p)}
                    className={cn(
                      "w-full flex items-start gap-4 px-8 py-4 text-left transition-colors hover:bg-muted/40",
                      active && "bg-muted/60"
                    )}
                  >
                    <div className="h-9 w-9 rounded-md flex items-center justify-center shrink-0 bg-muted border border-border">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">Ref. {p.ref}</span>
                        {p.tipo && <span className="text-xs text-foreground font-medium">{p.tipo}</span>}
                        {p.accion && <span className="text-xs text-muted-foreground">· {p.accion}</span>}
                      </div>
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">
                        {[p.ciudad, p.zona].filter(Boolean).join(", ") || "Ubicación no disponible"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        {precio && <span>{precio}</span>}
                        {p.habitaciones > 0 && <span>{p.habitaciones} hab</span>}
                        {p.m_construidos > 0 && <span>{p.m_construidos} m²</span>}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
                      {p.noVistas > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {p.noVistas} nueva{p.noVistas > 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {p.totalDemandas} demanda{p.totalDemandas !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {total > POR_PAGINA && (
          <div className="shrink-0 border-t border-border px-7">
            <Paginador
              pagina={pagina}
              porPagina={POR_PAGINA}
              total={total}
              onCambiar={setPagina}
              cargando={loading || fueraDeRango}
            />
          </div>
        )}
      </div>

      {/* ── Right: property detail + demands ── */}
      {selected && (
        <div className="w-96 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <p className="text-xs font-mono text-muted-foreground">Ref. {selected.ref}</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {[selected.tipo, selected.accion].filter(Boolean).join(" · ") || "Propiedad"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!editando ? (
                <button onClick={abrirEdicion} className="text-muted-foreground hover:text-foreground transition-colors" title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={guardarEdicion}
                  disabled={savingEdit}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-500 hover:text-emerald-400 disabled:opacity-50"
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar
                </button>
              )}
              <button
                onClick={() => { setSelected(null); setDemandas([]); setEditando(false) }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Propiedad info */}
            <div className="p-5 border-b border-border space-y-3">
              {editando ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Tipo", key: "tipo" },
                    { label: "Acción", key: "accion" },
                    { label: "Ciudad", key: "ciudad" },
                    { label: "Zona", key: "zona" },
                    { label: "Alq. €/mes", key: "precio_alquiler", numeric: true },
                    { label: "Venta €", key: "precio_venta", numeric: true },
                    { label: "Habitaciones", key: "habitaciones", numeric: true },
                    { label: "Baños", key: "banyos", numeric: true },
                    { label: "m² const.", key: "m_construidos", numeric: true },
                  ].map(({ label, key, numeric }) => (
                    <div key={key} className="space-y-0.5">
                      <label className="text-[10px] text-muted-foreground">{label}</label>
                      <input
                        type={numeric ? "number" : "text"}
                        value={String((editFields as any)[key] ?? "")}
                        onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-full h-7 px-2 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {(selected.ciudad || selected.zona) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ubicación</span>
                      <span className="text-foreground">{[selected.ciudad, selected.zona].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {(selected.precio_alquiler > 0 || selected.precio_venta > 0) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Precio</span>
                      <span className="text-foreground font-medium">{fmtPrecio(selected.precio_alquiler, selected.precio_venta)}</span>
                    </div>
                  )}
                  {selected.habitaciones > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Habitaciones</span>
                      <span className="text-foreground">{selected.habitaciones}</span>
                    </div>
                  )}
                  {selected.banyos > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Baños</span>
                      <span className="text-foreground">{selected.banyos}</span>
                    </div>
                  )}
                  {selected.m_construidos > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">m² construidos</span>
                      <span className="text-foreground">{selected.m_construidos}</span>
                    </div>
                  )}
                  {!selected.ciudad && !selected.zona && selected.precio_alquiler === 0 && selected.precio_venta === 0 && (
                    <p className="text-muted-foreground/60 italic">Sin datos de propiedad</p>
                  )}
                </div>
              )}
              {!editando && (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleDesactivar}
                    className="flex-1 h-7 rounded border border-border text-xs text-muted-foreground hover:border-amber-400/50 hover:text-amber-400 transition-colors"
                  >
                    Desactivar
                  </button>
                  <button
                    onClick={handleEliminarPropiedad}
                    className="flex-1 h-7 rounded border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 hover:border-red-500/60 transition-colors"
                  >
                    Eliminar propiedad
                  </button>
                </div>
              )}
            </div>

            {/* Demands list */}
            <div className="p-5 space-y-4">
              {loadingDemandas ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : demandas.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 italic">Sin demandas para esta propiedad</p>
              ) : (
                (() => {
                  const aprobadas  = demandas.filter((d) => d.estado === "Cualificado")
                  const descartadas = demandas.filter((d) => d.estado === "Descartado")
                  const resto       = demandas.filter((d) => d.estado !== "Cualificado" && d.estado !== "Descartado")
                  const grupos: { label: string; color: string; items: Demanda[] }[] = [
                    { label: "Aprobadas",   color: "text-emerald-400", items: aprobadas },
                    { label: "En proceso",  color: "text-muted-foreground", items: resto },
                    { label: "Descartadas", color: "text-red-400",     items: descartadas },
                  ].filter((g) => g.items.length > 0)
                  return grupos.map((grupo) => (
                    <div key={grupo.label} className="space-y-2">
                      <p className={`text-[10px] font-semibold uppercase tracking-wider ${grupo.color}`}>
                        {grupo.label} ({grupo.items.length})
                      </p>
                      {grupo.items.map((d) => (
                  <div key={d.id} className="rounded-lg border border-border bg-background p-3 space-y-2.5">
                    {/* Cabecera demanda */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                          {(d.nombre ?? d.email ?? "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{d.nombre ?? "Sin nombre"}</p>
                          <p className="text-[10px] text-muted-foreground">{timeAgo(d.fecha_creacion)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {d.fuente && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${FUENTE_CFG[d.fuente] ?? "bg-muted text-muted-foreground border-border"}`}>
                            {d.fuente}
                          </span>
                        )}
                        <button
                          onClick={() => handleEliminarDemanda(d.id)}
                          disabled={deletingId === d.id}
                          className="text-muted-foreground/40 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {deletingId === d.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>

                    {/* Contacto */}
                    {(d.telefono || d.email) && (
                      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                        {d.telefono && (
                          <a href={`tel:${d.telefono}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                            <Phone className="h-2.5 w-2.5" />
                            {d.telefono}
                          </a>
                        )}
                        {d.email && (
                          <a href={`mailto:${d.email}`} className="flex items-center gap-1 hover:text-foreground transition-colors max-w-full">
                            <Mail className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{d.email}</span>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Mensaje */}
                    {d.mensaje && (
                      <p className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 line-clamp-3 italic">
                        &ldquo;{d.mensaje}&rdquo;
                      </p>
                    )}

                    {/* Datos cualificación del bot */}
                    {d.datos_cualificacion && Object.keys(d.datos_cualificacion).length > 0 && (
                      <div className="text-[10px] bg-emerald-500/5 border border-emerald-500/20 rounded p-2 space-y-0.5">
                        {Object.entries(d.datos_cualificacion).map(([k, v]) => (
                          <div key={k} className="flex gap-1">
                            <span className="text-emerald-600 capitalize font-medium">{k}:</span>
                            <span className="text-foreground">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Notas */}
                    {editingDemandId === d.id ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editNotas}
                          onChange={(e) => setEditNotas(e.target.value)}
                          rows={2}
                          placeholder="Añadir nota..."
                          autoFocus
                          className="w-full px-2 py-1.5 text-[10px] rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => guardarNotas(d.id)}
                            disabled={savingNota}
                            className="flex items-center gap-1 text-[10px] font-medium text-emerald-500 hover:text-emerald-400 disabled:opacity-50"
                          >
                            {savingNota ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                            Guardar
                          </button>
                          <button onClick={() => setEditingDemandId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingDemandId(d.id); setEditNotas(d.notas ?? "") }}
                        className="text-[10px] text-left w-full text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        {d.notas
                          ? <span className="italic text-muted-foreground">{d.notas}</span>
                          : <span>+ Añadir nota</span>}
                      </button>
                    )}

                    {/* Estado */}
                    <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border">
                      {ESTADOS_DEMANDA.map((e) => (
                        <button
                          key={e}
                          onClick={() => cambiarEstado(d.id, e)}
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition-all ${
                            d.estado === e
                              ? ESTADO_DEMANDA_CFG[e].badge
                              : "border-border text-muted-foreground hover:border-muted-foreground/40"
                          }`}
                        >
                          {ESTADO_DEMANDA_CFG[e].label}
                        </button>
                      ))}
                    </div>
                  </div>
                      ))}
                    </div>
                  ))
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
