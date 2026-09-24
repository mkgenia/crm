"use client"

import { useEffect, useMemo, useState } from "react"
import { MapPin, GripVertical, PhoneOff } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { claseColor, clasePunto, opcionesDe, type Catalogo } from "@/lib/catalogos"
import { actualizarEstadoCaptacion } from "@/lib/actions/captaciones"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { getCaptaciones } from "@/lib/actions/captaciones"

type Captacion = Awaited<ReturnType<typeof getCaptaciones>>["filas"][number]

// Cards visibles por columna antes de "Ver más" (evita renderizar cientos de nodos)
const PAGE_SIZE = 15

function fmtPrecio(n: number | null) {
  if (!n) return "0 €"
  return `${n.toLocaleString("es-ES")} €`
}

function hasPhone(tel: string | null) {
  if (!tel) return false
  const l = tel.toLowerCase()
  return !l.includes("no disponible") && !l.includes("privado") && tel.trim() !== ""
}

function PipelineCard({
  cap,
  onClick,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  cap: Captacion
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}) {
  const sinTel = !hasPhone(cap.telefono)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-lg border border-border bg-background p-3 transition-all hover:border-violet-500/40 hover:shadow-md hover:shadow-violet-500/5",
        dragging && "opacity-40 ring-1 ring-violet-500/40"
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground leading-tight truncate">
            {cap.calle ?? cap.nombre ?? "Sin dirección"}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {cap.barrio && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" /> {cap.barrio}
              </span>
            )}
            {(cap.metros || cap.habitaciones) && (
              <span className="shrink-0">
                {[cap.metros && `${cap.metros}m²`, cap.habitaciones && `${cap.habitaciones}h`].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">{fmtPrecio(cap.precio)}</span>
            {sinTel && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                <PhoneOff className="h-2.5 w-2.5" /> Sin tel.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  captaciones: Captacion[]
  onSelect: (id: number) => void
  /**
   * Los catálogos, si el padre ya los tiene.
   *
   * La página de captaciones los pide en el servidor y se los pasa a la lista;
   * el día que la lista se los pase también a este tablero —una línea— se deja
   * de hacer la petición del efecto. Mientras tanto se piden aquí, que es
   * preferible a no tener columnas.
   */
  catalogos?: Catalogo[]
}

/**
 * Lo que sabe la cabecera de una columna, contado en la base de datos.
 *
 * `null` es "no se ha podido contar", y se pinta como nada. Un 0 en su lugar se
 * lee como "aquí no hay ninguna", que es peor que no decir nada.
 */
type TotalColumna = { filas: number | null; importe: number | null }

/**
 * El tablero de captaciones.
 *
 * Dos cosas que hacía mal y que aquí se arreglan:
 *
 * 1. Las columnas salían de ESTADOS_CAPTACION, una lista escrita en
 *    `types/captaciones.ts`. Ahora salen del catálogo `estado_lead`, que es
 *    donde viven los valores que guarda `captaciones.estado_crm` —los mismos
 *    siete que usa el pipeline de leads, por eso comparten lista— con su
 *    nombre, su color y su orden tal y como estén en /configuracion/catalogos.
 *
 * 2. Los números se sumaban SOBRE LAS FILAS CARGADAS, y las filas cargadas son
 *    una página de 50. La cabecera decía "Contactado 38 · 9.832.073 €" cuando
 *    en la base había 608 y 81.859.526 €. Ahora se cuentan en Postgres.
 *
 * Lo que sigue sin ser redondo, y se deja dicho a propósito: las tarjetas son
 * la página que ha traído la lista y los números son los de toda la tabla, así
 * que con un filtro o una búsqueda activos la cabecera cuenta más de lo que se
 * ve. El sitio natural de este tablero es la pantalla de prospectos, que aún no
 * existe; cuando se haga, esto se rehace ahí con su propia consulta y contra el
 * catálogo `estado_prospecto`. Hasta entonces, el recuento dice de dónde sale
 * en su `title` en vez de fingir que es lo que hay en pantalla.
 */
export function CaptacionesPipeline({ captaciones, onSelect, catalogos: catalogosProp = [] }: Props) {
  const [catalogosCargados, setCatalogosCargados] = useState<Catalogo[]>([])
  const [catalogosPedidos, setCatalogosPedidos] = useState(false)
  const catalogos = catalogosProp.length ? catalogosProp : catalogosCargados
  /**
   * Si vienen por props ya están: no hay petición que esperar.
   *
   * Mirando sólo la bandera del efecto, un padre que pasara los catálogos sin
   * ninguna fila de `estado_lead` —todas archivadas desde el panel— dejaba el
   * tablero con un "Cargando el tablero…" que no iba a terminar nunca, porque
   * ese efecto sale por la primera línea y no llega a levantarla.
   */
  const catalogosListos = catalogosProp.length > 0 || catalogosPedidos
  /** Por valor de estado. Vacío mientras no se sepa; nunca se inventa un 0. */
  const [totales, setTotales] = useState<Record<string, TotalColumna>>({})
  // Overrides optimistas: id -> nuevo estado tras arrastrar
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  // Cuántas cards se muestran por columna (paginación incremental)
  const [limites, setLimites] = useState<Record<string, number>>({})

  const columnas = useMemo(() => opcionesDe(catalogos, "estado_lead"), [catalogos])

  useEffect(() => {
    if (catalogosProp.length) return
    let vivo = true
    ;(async () => {
      try {
        const cats = await getCatalogosActivos()
        if (vivo) setCatalogosCargados(cats)
      } catch {
        // Sin catálogo no hay columnas, así que se dice. En silencio el tablero
        // parecería vacío y nadie sabría que el problema es de lectura.
        if (vivo) toast.error("No se pudieron cargar los estados del tablero")
      } finally {
        if (vivo) setCatalogosPedidos(true)
      }
    })().catch(() => {})
    return () => { vivo = false }
  }, [catalogosProp.length])

  /**
   * Los recuentos, contados en la base de datos.
   *
   * Se intenta primero con una sola consulta agrupada —PostgREST sabe agrupar y
   * sumar si el proyecto tiene habilitadas las funciones de agregado— y, si no
   * las tiene, se cae a un recuento por columna con `head: true`, que trae la
   * cabecera con el total y ninguna fila. En ese caso nos quedamos sin el
   * importe y no se pinta: antes que sumar los precios de las cincuenta filas
   * cargadas y llamarlo total, mejor no decir nada.
   */
  useEffect(() => {
    if (!columnas.length) return
    let vivo = true
    const valores = columnas.map((c) => c.valor)

    ;(async () => {
      const supabase = createClient()

      // Quién soy decide qué se cuenta: el administrador ve todas las
      // captaciones y un agente sólo las suyas, igual que hace
      // getTotalesCaptaciones en el servidor. Si no se puede averiguar, se
      // cuenta lo que deje ver RLS y no se rompe nada.
      let uid: string | null = null
      let isAdmin = false
      const { data: { user } } = await supabase.auth.getUser()
      uid = user?.id ?? null
      if (uid) {
        const { data: perfil } = await supabase
          .from("perfiles").select("rol").eq("id", uid).maybeSingle()
        isAdmin = (perfil as { rol: string } | null)?.rol === "Admin"
      }
      if (!vivo) return

      let agrupado = supabase
        .from("captaciones")
        .select("estado_crm, filas:id.count(), importe:precio.sum()")
        .eq("activo", true)
      if (!isAdmin && uid) agrupado = agrupado.eq("agente_id", uid)

      const { data, error } = await agrupado
      if (!vivo) return

      if (!error && Array.isArray(data)) {
        const acc: Record<string, TotalColumna> = {}
        for (const v of valores) acc[v] = { filas: 0, importe: 0 }
        for (const fila of data as Array<{ estado_crm: string | null; filas: number | null; importe: number | null }>) {
          // Una captación con un estado que ya no es columna cuenta en la
          // primera, que es donde el tablero deja también su tarjeta.
          const clave = fila.estado_crm && acc[fila.estado_crm] ? fila.estado_crm : valores[0]
          const destino = acc[clave]
          destino.filas = (destino.filas ?? 0) + Number(fila.filas ?? 0)
          destino.importe = (destino.importe ?? 0) + Number(fila.importe ?? 0)
        }
        setTotales(acc)
        return
      }

      // `estado === null` cuenta TODO el ámbito, sin filtrar por columna.
      const contar = async (estado: string | null) => {
        let q = supabase
          .from("captaciones")
          .select("id", { count: "exact", head: true })
          .eq("activo", true)
        if (estado !== null) q = q.eq("estado_crm", estado)
        if (!isAdmin && uid) q = q.eq("agente_id", uid)
        const { count, error: errorCuenta } = await q
        return errorCuenta ? null : count ?? 0
      }

      const [cuentas, totalAmbito] = await Promise.all([
        Promise.all(valores.map(async (v) => ({ v, filas: await contar(v) }))),
        contar(null),
      ])
      if (!vivo) return

      const acc: Record<string, TotalColumna> = {}
      for (const { v, filas } of cuentas) acc[v] = { filas, importe: null }

      // Las que tienen `estado_crm` a null, o un valor que ya no es columna, no
      // las trae ninguna de las consultas de arriba —todas son `.eq()` de un
      // valor concreto— pero el tablero SÍ les deja la tarjeta en la primera
      // columna, igual que hacen `estadoDe` y `porColumna`. Sin esta resta la
      // cabecera enseñaría menos captaciones de las que hay debajo, que es la
      // misma mentira que vinimos a quitar, sólo que en la otra dirección. La
      // consulta agrupada ya las mete ahí; esto es que la de respaldo cuente
      // igual y no según qué camino haya tomado la petición.
      const primera = valores[0]
      const completas = cuentas.every((c) => c.filas !== null)
      if (primera && completas && totalAmbito !== null) {
        const suma = cuentas.reduce((n, c) => n + (c.filas ?? 0), 0)
        const sueltas = totalAmbito - suma
        if (sueltas > 0) acc[primera] = { filas: (acc[primera].filas ?? 0) + sueltas, importe: null }
      }

      // Ni una cuenta ha salido: se dice. Columnas sin número y sin explicación
      // se leen como un tablero a medio cargar y nadie sabría que hay un fallo.
      if (cuentas.every((c) => c.filas === null)) {
        toast.error("No se pudieron contar las captaciones")
      }
      setTotales(acc)
    })().catch(() => {
      if (vivo) toast.error("No se pudieron contar las captaciones")
    })

    return () => { vivo = false }
  }, [columnas])

  /** El estado que le toca a una tarjeta, ya sin columnas que no existen. */
  const estadoDe = (cap: Captacion): string => {
    const e = overrides[cap.id] ?? cap.estado_crm ?? ""
    return columnas.some((c) => c.valor === e) ? e : (columnas[0]?.valor ?? e)
  }

  const porColumna = useMemo(() => {
    const map: Record<string, Captacion[]> = {}
    for (const c of columnas) map[c.valor] = []
    for (const cap of captaciones) {
      const e = overrides[cap.id] ?? cap.estado_crm ?? ""
      const clave = map[e] ? e : (columnas[0]?.valor ?? e)
      ;(map[clave] ??= []).push(cap)
    }
    return map
  }, [captaciones, overrides, columnas])

  /** Mueve una tarjeta de una cabecera a otra sin volver a contar nada. */
  function ajustarTotales(desde: string, hacia: string, precio: number) {
    setTotales((prev) => {
      const origen = prev[desde]
      const destino = prev[hacia]
      if (!origen || !destino) return prev
      return {
        ...prev,
        [desde]: {
          filas: origen.filas === null ? null : Math.max(0, origen.filas - 1),
          importe: origen.importe === null ? null : Math.max(0, origen.importe - precio),
        },
        [hacia]: {
          filas: destino.filas === null ? null : destino.filas + 1,
          importe: destino.importe === null ? null : destino.importe + precio,
        },
      }
    })
  }

  async function moverA(estado: string) {
    const id = dragId
    setDragId(null)
    setDragOverCol(null)
    if (id == null) return

    const cap = captaciones.find((c) => c.id === id)
    if (!cap) return
    const actual = estadoDe(cap)
    if (actual === estado) return

    // Optimista: la tarjeta y, con ella, los dos recuentos. Si la cabecera se
    // quedara con el número de antes parecería que la captación no ha llegado.
    setOverrides((prev) => ({ ...prev, [id]: estado }))
    ajustarTotales(actual, estado, cap.precio ?? 0)

    const res = await actualizarEstadoCaptacion(id, estado).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se pudo mover la captación",
    }))

    if (res?.error) {
      // Revertir las dos cosas
      setOverrides((prev) => {
        const next = { ...prev }
        if ((cap.estado_crm ?? "") === actual) delete next[id]
        else next[id] = actual
        return next
      })
      ajustarTotales(estado, actual, cap.precio ?? 0)
      toast.error(res.error)
      return
    }
    toast.success(`Movido a "${columnas.find((c) => c.valor === estado)?.nombre ?? estado}"`)
  }

  if (!columnas.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {catalogosListos
          ? "No hay estados activos en el catálogo. Se encienden en Configuración → Catálogos."
          : "Cargando el tablero…"}
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 pt-1 scrollbar-x-visible">
      {columnas.map((col) => {
        const estado = col.valor
        const cards = porColumna[estado] ?? []
        const total = totales[estado]
        const filas = total?.filas ?? null
        const importe = total?.importe ?? null
        const isOver = dragOverCol === estado
        const limite = limites[estado] ?? PAGE_SIZE
        const visibles = cards.slice(0, limite)
        const restantes = cards.length - visibles.length
        return (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(estado) }}
            onDragLeave={(e) => {
              // Solo limpiar si salimos realmente de la columna
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null)
            }}
            onDrop={(e) => { e.preventDefault(); moverA(estado) }}
            className={cn(
              "flex flex-col w-72 shrink-0 rounded-xl border bg-card/50 overflow-hidden transition-colors",
              isOver ? "border-violet-500/50 bg-violet-500/5" : "border-border"
            )}
          >
            {/* Barra de acento superior, del color que tenga el estado en el catálogo */}
            <div className={cn("h-0.5 w-full", clasePunto(col.color))} />

            {/* Header columna */}
            <div className="px-3 pt-3 pb-2 border-b border-border/60 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full shrink-0", clasePunto(col.color))} />
                <span className="text-sm font-medium text-foreground">{col.nombre}</span>
                {/* Sin recuento no se pinta pastilla: un 0 diría "no hay ninguna". */}
                {filas !== null && (
                  <span
                    title={`${filas.toLocaleString("es")} en la base de datos · ${cards.length} en la página cargada`}
                    className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums"
                  >
                    {filas.toLocaleString("es")}
                  </span>
                )}
              </div>
              {importe !== null && (
                <span className={cn(
                  "w-fit rounded border px-1.5 py-0.5 text-xs tabular-nums",
                  claseColor(col.color)
                )}>
                  {fmtPrecio(importe)}
                </span>
              )}
            </div>

            {/* Cards */}
            {/* Los hijos no encogen: con la columna llena, flex aplastaría las
                tarjetas en vez de desplazar. Ver la nota de la ficha del
                prospecto. */}
            <div className="flex-1 flex flex-col gap-2 p-2 min-h-[24rem] overflow-y-auto scrollbar-thin [&>*]:shrink-0">
              {visibles.map((cap) => (
                <PipelineCard
                  key={cap.id}
                  cap={cap}
                  dragging={dragId === cap.id}
                  onDragStart={() => setDragId(cap.id)}
                  onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                  onClick={() => onSelect(cap.id)}
                />
              ))}
              {restantes > 0 && (
                <button
                  onClick={() => setLimites((prev) => ({ ...prev, [estado]: limite + PAGE_SIZE }))}
                  className="w-full py-2 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
                >
                  Ver más ({restantes})
                </button>
              )}
              {cards.length === 0 && (
                <div className={cn(
                  "flex-1 flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground/50 transition-colors",
                  isOver ? "border-violet-500/40 text-violet-500/70" : "border-border/60"
                )}>
                  {isOver ? "Suelta aquí" : "Arrastra una captación aquí"}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
