"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Confirmar } from "@/components/shared/confirmar"
import { createClient } from "@/lib/supabase/client"
import { actualizarPropiedad, desactivarPropiedad, eliminarDemanda, eliminarPropiedad } from "@/lib/actions/demandas"
import { Search, X, Building2, Pencil, Check, Loader2, Trash2, Phone, Mail } from "lucide-react"
import { toast } from "sonner"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import { traerTodo } from "@/lib/supabase/paginar"
import { cn } from "@/lib/utils"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { claseColor, clasePunto, opcionesDe, type Catalogo } from "@/lib/catalogos"
import { ESTADOS_DEMANDA_FALLBACK, FUENTE_CFG } from "@/types/demandas"
import type { Demanda, PropiedadDemanda, EstadoDemanda } from "@/types/demandas"

interface PropiedadConConteos extends PropiedadDemanda {
  totalDemandas: number
  noVistas: number
}

/**
 * Lo que devuelve la consulta: la propiedad más lo que se le pide de `demandas`.
 *
 *   · `conteo` es el agregado, o sea cuántas demandas tiene la propiedad. Lleva
 *     alias porque cuando hay corte de fecha viaja al lado de OTRA lectura de la
 *     misma tabla, y sin alias PostgREST no sabe a cuál de las dos le toca cada
 *     filtro: medido, `demandas.fecha_creacion=gte.…` se lo quedaba la otra y el
 *     agregado salía SIN filtrar (una propiedad con 5 demandas en la semana
 *     decía 113, que son las de toda su vida).
 *   · `marca` sólo existe cuando hay corte y no es un dato que se pinte: es la
 *     mitad de la consulta que PODA la lista. Ver `fetchPropiedades`.
 */
type FilaPropiedad = PropiedadDemanda & {
  conteo?: { count: number }[] | null
  marca?: { id: string }[] | null
}

/** Los campos que se editan a mano en la ficha de la propiedad. */
type CampoEditable =
  | "tipo" | "accion" | "ciudad" | "zona"
  | "precio_alquiler" | "precio_venta"
  | "habitaciones" | "banyos" | "m_construidos"

/**
 * Las cajas del formulario, con las etiquetas que se leen y cuáles son números.
 *
 * Fuera del JSX para que el tipo de `key` sea el de arriba y no `string`: con
 * `string` había que leer el valor con `(editFields as any)[key]`, y ese `any`
 * es lo que dejaba pasar sin avisar el fallo de guardar el texto crudo en una
 * columna numérica.
 */
const CAMPOS_EDITABLES: Array<{ label: string; key: CampoEditable; numeric?: boolean }> = [
  { label: "Tipo",         key: "tipo" },
  { label: "Acción",       key: "accion" },
  { label: "Ciudad",       key: "ciudad" },
  { label: "Zona",         key: "zona" },
  { label: "Alq. €/mes",   key: "precio_alquiler", numeric: true },
  { label: "Venta €",      key: "precio_venta",    numeric: true },
  { label: "Habitaciones", key: "habitaciones",    numeric: true },
  { label: "Baños",        key: "banyos",          numeric: true },
  { label: "m² const.",    key: "m_construidos",   numeric: true },
]

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

export default function DemandasPage({
  catalogos: catalogosProp = [],
  desdeInicial = "",
  etiquetaDesde = "",
}: {
  catalogos?: Catalogo[]
  /**
   * Desde cuándo mirar las demandas, en ISO. Lo calcula la portada con el mismo
   * corte con el que contó el número de su tarjeta, y lo valida el servidor
   * (page.tsx) antes de bajarlo: lo que no cuadra llega vacío y no filtra nada.
   */
  desdeInicial?: string
  /** Y cómo se lee ese corte ("Entradas hoy"), escrito también en el servidor. */
  etiquetaDesde?: string
} = {}) {
  /**
   * Los estados de una demanda salen del catálogo `estado_demanda`, no de una
   * lista escrita en el código: un estado creado desde /configuracion/catalogos
   * tiene que aparecer aquí sin desplegar nada.
   *
   * `catalogos` puede llegar por props —el día que su page.tsx los pida, como
   * ya hace el de leads— y, mientras no llegue, los pide el efecto de más abajo.
   *
   * ESTADOS_UI es lo que se pinta: el catálogo cuando lo hay, y los cuatro de
   * siempre mientras el INSERT no esté ejecutado. Sin ese respaldo la ficha se
   * quedaría sin un solo botón de estado, que es peor que enseñar los de antes.
   * Por eso el nombre y el color se buscan en ESTADOS_UI y no con
   * `nombreDe`/`colorDe`: con el catálogo vacío esos dos no tienen de dónde
   * sacarlos.
   */
  const [catalogosCargados, setCatalogosCargados] = useState<Catalogo[]>([])
  const catalogos = catalogosProp.length ? catalogosProp : catalogosCargados
  const ESTADOS_CAT = opcionesDe(catalogos, "estado_demanda")
  const ESTADOS_UI = ESTADOS_CAT.length ? ESTADOS_CAT : ESTADOS_DEMANDA_FALLBACK

  const catEstado = (e: string | null) => ESTADOS_UI.find((c) => c.valor === e) ?? null
  /** Una demanda con un estado retirado se sigue leyendo: cae a su propio valor. */
  const nombreEstado = (e: string | null) => catEstado(e)?.nombre ?? (e || "Sin estado")
  const colorEstado = (e: string | null) => catEstado(e)?.color ?? null

  const [propiedades, setPropiedades] = useState<PropiedadConConteos[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  /** Lo que se ha buscado de verdad, ya con el rebote aplicado. */
  const [termino, setTermino] = useState("")
  const [pagina, setPagina] = useState(1)
  /**
   * EL CORTE DE FECHA, el periodo que venía pulsado en la portada.
   *
   * Mientras está puesto, esta pantalla contesta a otra pregunta: no "qué
   * propiedades hay" sino "qué propiedades han recibido demandas desde X", y
   * todos los números que se enseñan —las de cada fila, el total de la cabecera
   * y las del panel de la derecha— hablan sólo de ese periodo. Es lo que hace
   * que una tarjeta que dice 20 lleve a 20 y no a las 1.825 de siempre.
   *
   * Se suelta con su chapa, y soltarlo es "verlas todas".
   */
  const [desde, setDesde] = useState<string>(desdeInicial)
  /** Propiedades que cumplen el filtro, contadas en la base de datos. */
  const [total, setTotal] = useState(0)
  /** null = todavía no se sabe; un 0 inventado diría que no hay demandas. */
  const [totalDemandas, setTotalDemandas] = useState<number | null>(null)
  const [selected, setSelected] = useState<PropiedadConConteos | null>(null)
  /**
   * Los dos avisos de esta pantalla, como diálogo de la aplicación.
   *
   * Eran window.confirm(), y los navegadores incrustados los cancelan solos: el
   * botón parecía muerto. El de borrar para siempre es el que más asusta —no
   * borraba nada, pero tampoco decía por qué—.
   */
  const [confirmDesactivar, setConfirmDesactivar] = useState(false)
  const [confirmEliminar, setConfirmEliminar] = useState(false)
  const [demandas, setDemandas] = useState<Demanda[]>([])
  const [loadingDemandas, setLoadingDemandas] = useState(false)

  // Edit propiedad
  const [editando, setEditando] = useState(false)
  // Lo que hay en las cajas es TEXTO, también en las numéricas: un
  // <input type="number"> devuelve string. Tenerlo tipado como
  // Partial<PropiedadDemanda> era decir que ahí vivían números, y de esa mentira
  // salía que al guardar se colara una cadena en `precio_alquiler`.
  const [editFields, setEditFields] = useState<Partial<Record<CampoEditable, string>>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  // Edit demand notes
  const [editingDemandId, setEditingDemandId] = useState<string | null>(null)
  /** La demanda cuyo selector de estado está abierto. Una a la vez. */
  const [estadoAbierto, setEstadoAbierto] = useState<string | null>(null)
  const [editNotas, setEditNotas] = useState("")
  const [savingNota, setSavingNota] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /**
   * Una sola instancia, y con la identidad garantizada.
   *
   * `createClient()` suelto en el cuerpo del componente devuelve un objeto
   * nuevo en cada render. En el navegador @supabase/ssr guarda uno y lo
   * reutiliza, pero eso es un detalle de su implementación, no una promesa: por
   * si acaso, los `useCallback` de abajo se dejaban sin declararlo en las
   * dependencias, porque declararlo habría recreado la función en cada render y
   * el efecto de la lista se habría puesto a pedir páginas sin parar. El
   * inicializador perezoso de useState lo fija de una vez, así que ya se puede
   * declarar y el lint deja de avisar de algo real.
   */
  const [supabase] = useState(createClient)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listaRef = useRef<HTMLDivElement | null>(null)
  const peticionRef = useRef(0)
  /** Cada carga de demandas se queda con su número, como la de propiedades. */
  const peticionDemandasRef = useRef(0)
  const selectedRef = useRef<PropiedadConConteos | null>(null)
  // El canal de realtime se suscribe una vez, así que su callback no vería los
  // cambios de `selected` si lo leyera de la clausura. Se le deja en una ref,
  // pero puesta al día en un efecto y no durante el render: escribir una ref
  // mientras se renderiza es lo que React prohíbe —un render que se descarta
  // deja la ref apuntando a algo que la pantalla nunca llegó a enseñar— y es
  // además lo que rechazaba el lint del compilador.
  useEffect(() => { selectedRef.current = selected }, [selected])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  /**
   * La página que se pide de verdad, ya recortada al número de páginas que hay.
   *
   * Borrar o desactivar puede dejar la actual fuera de rango: estabas en la 2
   * con 51 propiedades, quitas una y quedan 50, o sea una sola página. Antes eso
   * lo arreglaba un efecto con `setPagina(paginas)` dentro, que es justo lo que
   * el compilador de React rechaza —un setState en un efecto para calcular algo
   * que ya se sabe al renderizar— y que además pintaba un "Cargando..." de más
   * mientras daba la vuelta. Recortando aquí, la lista ya se pide bien a la
   * primera y no hay estado intermedio que enseñar.
   */
  const paginaActual = Math.min(pagina, paginas)

  const fetchPropiedades = useCallback(async (pagina: number, termino: string, desde: string) => {
    // Cada petición se queda con su número. Si mientras va y viene se teclea otra
    // búsqueda o se cambia de página, la que llega tarde se descarta: si no, la
    // respuesta vieja pinta filas que no son las de la página que marca el
    // paginador, y eso es peor que no enseñar nada.
    const peticion = ++peticionRef.current
    setLoading(true)
    try {
      // Se llama `primeraFila` y no `desde`, que es como se llamaba: en esta
      // misma función vive ahora el corte de fecha con ese nombre, y un `const
      // desde` aquí lo taparía por alcance léxico sin que TypeScript dijera
      // nada — la consulta se filtraría por "desde la fila 50" en vez de por
      // "desde el lunes".
      const primeraFila = (pagina - 1) * POR_PAGINA

      /**
       * LAS DOS LECTURAS DE `demandas`, y por qué hacen falta las dos.
       *
       * `conteo:demandas(count)` deja que Postgres cuente las demandas de cada
       * propiedad. Antes se traían las filas enteras sólo para hacerles un
       * .length, y son esas las que reventaban el tope: 1.825 demandas viajando
       * para pintar un "89 demandas" en un lateral.
       *
       * `marca:demandas!inner(id)` sólo aparece CUANDO HAY CORTE, y no es un
       * dato: es lo que PODA la lista. Un `!inner` deja fuera a las propiedades
       * que no tienen ninguna demanda en el periodo, que es lo que convierte
       * esta pantalla en "las propiedades que han recibido demandas desde X".
       *
       * Y TIENE QUE SER UNA LECTURA DE FILAS, no el propio agregado. Medido
       * contra la base: `demandas!inner(count)` NO poda nada —el agregado
       * siempre devuelve una fila, aunque sea un 0, así que el `inner` no tiene
       * qué descartar— y la lista salía entera con medias filas diciendo "0
       * demandas". Con `!inner(id)` sí poda, y el `limit(1)` de abajo evita que
       * una propiedad con 113 demandas se traiga 113 identificadores para nada.
       *
       * Los dos alias son obligatorios: sin ellos PostgREST no sabe a cuál de
       * las dos lecturas le toca cada filtro y el agregado se queda sin filtrar.
       */
      // Anotado como `string` a propósito: supabase-js intenta deducir la forma
      // de la respuesta LEYENDO el literal del select, y con dos literales
      // posibles se rinde con un error de tipos en vez de quedarse con la unión.
      // La forma de la fila la dice `FilaPropiedad`, aquí arriba.
      const columnas: string = desde
        ? "*, marca:demandas!inner(id), conteo:demandas(count)"
        : "*, conteo:demandas(count)"

      let q = supabase
        .from("propiedades_demanda")
        .select(columnas, { count: "exact" })
        .eq("activo", true)

      // El MISMO corte a las dos lecturas: una decide qué propiedades salen y la
      // otra cuántas demandas se le cuentan a cada una. Con el corte en una sola,
      // la fila diría "113 demandas" dentro de una lista de esta semana.
      if (desde) {
        q = q.gte("marca.fecha_creacion", desde).gte("conteo.fecha_creacion", desde)
      }

      const t = limpiarBusqueda(termino)
      if (t) q = q.or(`ref.ilike.%${t}%,ciudad.ilike.%${t}%,zona.ilike.%${t}%,tipo.ilike.%${t}%`)

      // El id desempata el orden. Con updated_at a secas, dos propiedades con la
      // misma marca de tiempo pueden intercambiarse entre una petición y la
      // siguiente, y entonces una sale dos veces y otra no sale en ninguna.
      let consulta = q
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
      // Una sola demanda por propiedad basta para podar: lo que se mira de
      // `marca` es si viene o no viene, nunca lo que trae dentro.
      if (desde) consulta = consulta.limit(1, { referencedTable: "marca" })

      const { data, count, error } = await consulta
        .range(primeraFila, primeraFila + POR_PAGINA - 1)

      if (peticion !== peticionRef.current) return

      if (error) {
        toast.error("No se pudieron cargar las propiedades")
        return
      }

      // Pasando por `unknown`: con el select anotado como `string`, supabase-js
      // renuncia a deducir la fila y devuelve su tipo de "no he podido leer el
      // select", que no se parece a nada. Quien dice cómo viene cada fila es
      // `FilaPropiedad`, que es de donde salen los dos alias que se leen abajo.
      const filas = (data ?? []) as unknown as FilaPropiedad[]

      // Las no vistas van aparte porque en el mismo select harían falta dos
      // agregados de la misma tabla y uno de ellos filtrado. Aquí sí hacen falta
      // las filas para agruparlas, y aunque sean las de 50 propiedades pueden
      // pasar del tope de 1.000 después de un puente: traerTodo pagina hasta
      // agotarlas. El orden por id es lo que impide que ese paginado repita o se
      // salte filas y descuadre el recuento.
      const pendientes = new Map<string, number>()
      if (filas.length) {
        const ids = filas.map((p) => p.id)
        const sinVer = await traerTodo<{ propiedad_id: string }>(() => {
          let c = supabase
            .from("demandas")
            .select("propiedad_id")
            .in("propiedad_id", ids)
            .eq("visto", false)
          // El mismo corte que el resto de la pantalla: dentro de una lista de
          // esta semana, "3 nuevas" tiene que ser tres de esta semana. Si no, el
          // aviso verde apuntaría a demandas que la ficha ni siquiera va a
          // enseñar al abrirla.
          if (desde) c = c.gte("fecha_creacion", desde)
          return c.order("id", { ascending: true })
        })
        for (const d of sinVer) {
          pendientes.set(d.propiedad_id, (pendientes.get(d.propiedad_id) ?? 0) + 1)
        }
        if (peticion !== peticionRef.current) return
      }

      setPropiedades(filas.map((p) => {
        // `conteo` es el agregado y `marca` la mitad de la consulta que poda:
        // ninguna de las dos es un dato de la propiedad, así que se quedan fuera
        // del estado. Si `marca` se colara, viajaría hasta la ficha y hasta el
        // guardado de la propiedad como si fuera una columna suya.
        const propiedad: FilaPropiedad = { ...p }
        delete propiedad.conteo
        delete propiedad.marca
        return {
          ...propiedad,
          extras: p.extras ?? [],
          totalDemandas: p.conteo?.[0]?.count ?? 0,
          noVistas: pendientes.get(p.id) ?? 0,
        }
      }))
      setTotal(count ?? 0)
    } catch {
      // Una excepción —la red, o `traerTodo` quedándose sin páginas— no la
      // recoge el `if (error)` de arriba, porque ahí no hay respuesta que mirar.
      // Sin esto la promesa se rechazaba y quien mirase la pantalla sólo veía
      // la lista anterior sin que nada dijera que la nueva no ha llegado.
      if (peticion === peticionRef.current) toast.error("No se pudieron cargar las propiedades")
    } finally {
      // Sólo la última petición apaga el indicador: si lo apagase la que llega
      // tarde, la lista se daría por cargada mientras la buena sigue en camino.
      if (peticion === peticionRef.current) setLoading(false)
    }
  }, [supabase])

  const fetchTotalDemandas = useCallback(async (desde: string) => {
    // head:true trae sólo la cabecera con el total: la cabecera de la página
    // tiene que decir 1.825 aunque en pantalla haya 50 propiedades, y sumar lo
    // que se ve daría un número más pequeño cada vez que pasas de página.
    //
    // Con corte, este número es EL DE LA TARJETA de la portada: es el que tiene
    // que cuadrar con lo que prometía el número que se acaba de pulsar.
    let c = supabase.from("demandas").select("id", { count: "exact", head: true })
    if (desde) c = c.gte("fecha_creacion", desde)
    const { count, error } = await c
    // Si falla se deja en null y la cabecera no menciona las demandas. Poner un 0
    // sería decir que no hay ninguna, que es justo la clase de mentira silenciosa
    // que vinimos a quitar.
    if (error || count === null) return
    setTotalDemandas(count)
  }, [supabase])

  const fetchDemandas = useCallback(async (propiedadId: string, desde: string) => {
    // La misma guardia que la lista de propiedades, y por el mismo motivo:
    // pinchando rápido de una ficha a otra, la respuesta que llegaba tarde
    // pintaba las demandas de la propiedad anterior debajo de la cabecera de la
    // nueva, sin que nada en pantalla dijera que no eran las suyas.
    const peticion = ++peticionDemandasRef.current
    setLoadingDemandas(true)
    try {
      // Esta lista no se pagina: la propiedad más solicitada anda por las 90
      // demandas y caben de sobra. El count está para que el día que deje de ser
      // verdad se vea — PostgREST recorta en 1.000 devolviendo 200 OK.
      //
      // El mismo corte que la lista: la fila decía "3 demandas" y abrirla tiene
      // que enseñar esas tres, no las 113 de toda la vida de la propiedad.
      let c = supabase
        .from("demandas")
        .select("*", { count: "exact" })
        .eq("propiedad_id", propiedadId)
      if (desde) c = c.gte("fecha_creacion", desde)

      const { data, count, error } = await c
        .order("fecha_creacion", { ascending: false })

      if (peticion !== peticionDemandasRef.current) return

      if (error) {
        // Sin esto, un fallo de red dejaba el panel con el vacío de "sin demandas"
        // en una propiedad que sí las tiene.
        toast.error("No se pudieron cargar las demandas de esta propiedad")
        setDemandas([])
        return
      }
      const filas = (data ?? []) as Demanda[]
      if (count !== null && count > filas.length) {
        toast.warning(`Esta propiedad tiene ${count} demandas y sólo se han podido cargar ${filas.length}`)
      }
      setDemandas(filas)
    } catch {
      // Una excepción —la red, no un error de PostgREST— dejaba el panel
      // girando para siempre, porque el `setLoadingDemandas(false)` estaba al
      // final del camino feliz y nunca se llegaba a él.
      if (peticion === peticionDemandasRef.current) {
        toast.error("No se pudieron cargar las demandas de esta propiedad")
        setDemandas([])
      }
      return
    } finally {
      // Sólo la última apaga el indicador: si lo apagara la que llega tarde, el
      // panel se daría por cargado mientras la buena sigue en camino.
      if (peticion === peticionDemandasRef.current) setLoadingDemandas(false)
    }

    // Marcar como vistas, ya fuera del indicador: es una escritura y no debe
    // retener el panel. Si falla se deja el contador de "nuevas" como estaba:
    // ponerlo a 0 diría que se han leído cuando en la base siguen sin marcar y
    // volverían a salir en cuanto se recargue.
    //
    // Y sólo las que se han ENSEÑADO: con corte puesto, marcar como vista una
    // demanda de hace tres meses que esta pantalla no llega a pintar sería
    // borrar un aviso que nadie ha leído.
    try {
      let u = supabase
        .from("demandas").update({ visto: true })
        .eq("propiedad_id", propiedadId).eq("visto", false)
      if (desde) u = u.gte("fecha_creacion", desde)
      const { error: errorVisto } = await u
      if (errorVisto) return
    } catch {
      return
    }
    setPropiedades((prev) => prev.map((p) => p.id === propiedadId ? { ...p, noVistas: 0 } : p))
  }, [supabase])

  // Los catálogos no dependen de la búsqueda ni de la página: se piden una vez.
  // Si la lectura falla se dice —en silencio parecería que el CRM sólo tiene
  // cuatro estados— y se sigue con el respaldo, que al menos deja trabajar.
  useEffect(() => {
    if (catalogosProp.length) return
    let vivo = true
    ;(async () => {
      try {
        const cats = await getCatalogosActivos()
        if (vivo) setCatalogosCargados(cats)
      } catch {
        if (vivo) toast.error("No se pudieron cargar los estados de las demandas")
      }
    })().catch(() => {})
    return () => { vivo = false }
  }, [catalogosProp.length])

  // EL TOTAL DE LA CABECERA, EN SU PROPIO EFECTO.
  //
  // Estaba dentro del efecto del realtime, y ahora depende del corte: dejándolo
  // allí, soltar la chapa habría desmontado y vuelto a montar el canal de
  // realtime sin que eso tuviera nada que ver con lo que se pedía. Igual que el
  // resto, la cuenta va dentro de una función asíncrona para que el setState no
  // cuelgue del cuerpo del efecto.
  useEffect(() => {
    ;(async () => { await fetchTotalDemandas(desde) })().catch(() => {})
  }, [fetchTotalDemandas, desde])

  useEffect(() => {
    const channel = supabase
      .channel("demandas-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demandas" }, (payload) => {
        const nueva = payload.new as Demanda
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
          setDemandas((prev) => [nueva, ...prev])
        }
        toast("Nueva demanda recibida", {
          description: `${nueva.nombre ?? "Sin nombre"} · ${nueva.fuente ?? "Portal"}`,
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase])

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
    // Envuelto en una función asíncrona suelta: `fetchPropiedades` acaba
    // llamando a setState y llamarla a pelo desde el cuerpo del efecto es lo
    // que el lint del compilador marca como cascada de renders.
    ;(async () => { await fetchPropiedades(paginaActual, termino, desde) })().catch(() => {})
    // Al cambiar de página se vuelve arriba: si no, aterrizas a media lista
    // sobre filas que no son las que estabas mirando.
    listaRef.current?.scrollTo({ top: 0 })
  }, [paginaActual, termino, desde, fetchPropiedades])

  /** Cierra la ficha y descarta cualquier carga que siga en el aire. */
  function cerrarFicha() {
    // Sin subir el contador, una carga lanzada antes de cerrar aún podía llegar
    // y volver a llenar `demandas` de una ficha que ya no se ve.
    peticionDemandasRef.current++
    setSelected(null)
    setDemandas([])
    setEditando(false)
    setLoadingDemandas(false)
  }

  function selectPropiedad(p: PropiedadConConteos) {
    if (selected?.id === p.id) {
      cerrarFicha()
      return
    }
    setSelected(p)
    setEditando(false)
    fetchDemandas(p.id, desde).catch(() => {})
  }

  /** "Y enséñamelas todas, no sólo las de ese periodo." */
  function quitarDesde() {
    setDesde("")
    setPagina(1)
    // La ficha que hubiera abierta enseñaba sólo las del periodo: se vuelve a
    // pedir sin corte, porque si no se queda con una lista corta debajo de una
    // pantalla que ya dice "todas".
    if (selected) fetchDemandas(selected.id, "").catch(() => {})
  }

  function abrirEdicion() {
    if (!selected) return
    setEditFields({
      tipo:            selected.tipo   ?? "",
      accion:          selected.accion ?? "",
      ciudad:          selected.ciudad ?? "",
      zona:            selected.zona   ?? "",
      precio_alquiler: String(selected.precio_alquiler ?? ""),
      precio_venta:    String(selected.precio_venta    ?? ""),
      habitaciones:    String(selected.habitaciones    ?? ""),
      banyos:          String(selected.banyos          ?? ""),
      m_construidos:   String(selected.m_construidos   ?? ""),
    })
    setEditando(true)
  }

  async function guardarEdicion() {
    if (!selected) return
    const ficha = selected
    setSavingEdit(true)

    // Los campos del formulario son texto, siempre, aunque el input sea
    // `number`. Se normalizan UNA vez y lo mismo que se envía es lo que se
    // pinta: con `{ ...selected, ...editFields }` se colaban las cadenas
    // crudas en la fila, y la ficha se quedaba con precio_alquiler = "1200"
    // —una cadena— que sale sin separador de miles y descuadra cualquier
    // cuenta que la sume después.
    const texto = (v: unknown) => String(v ?? "").trim()
    const numero = (v: unknown) => Number(v) || 0
    const cambios = {
      tipo:            texto(editFields.tipo),
      accion:          texto(editFields.accion),
      ciudad:          texto(editFields.ciudad),
      zona:            texto(editFields.zona),
      precio_alquiler: numero(editFields.precio_alquiler),
      precio_venta:    numero(editFields.precio_venta),
      habitaciones:    numero(editFields.habitaciones),
      banyos:          numero(editFields.banyos),
      m_construidos:   numero(editFields.m_construidos),
    }

    // Un texto vacío no borra el valor: la acción no manda la columna y aquí
    // tampoco se toca, para que la pantalla diga exactamente lo que hay en la
    // base de datos y no una cosa distinta hasta la próxima recarga.
    const res = await actualizarPropiedad(ficha.id, {
      ...cambios,
      tipo:   cambios.tipo   || undefined,
      accion: cambios.accion || undefined,
      ciudad: cambios.ciudad || undefined,
      zona:   cambios.zona   || undefined,
    }).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se pudo guardar la propiedad",
    }))
    // Fuera del try/finally a propósito: con `.catch` el botón vuelve también
    // cuando la acción revienta, no sólo cuando devuelve un error.
    setSavingEdit(false)
    if (res.error) { toast.error(res.error); return }

    const updated: PropiedadConConteos = {
      ...ficha,
      ...cambios,
      tipo:   cambios.tipo   || ficha.tipo,
      accion: cambios.accion || ficha.accion,
      ciudad: cambios.ciudad || ficha.ciudad,
      zona:   cambios.zona   || ficha.zona,
    }
    setSelected(updated)
    setPropiedades((prev) => prev.map((p) => p.id === ficha.id ? updated : p))
    setEditando(false)
    toast.success("Propiedad actualizada")
  }

  async function cambiarEstado(demandaId: string, nuevoEstado: EstadoDemanda) {
    const anterior = demandas.find((d) => d.id === demandaId)?.estado
    if (anterior === nuevoEstado) return

    // Se pinta antes de que conteste la base para que la pastilla responda al
    // clic. Pero si el update falla se deshace y se avisa: hasta ahora el error
    // ni se miraba, así que la ficha se quedaba enseñando un estado que en la
    // base de datos nunca llegó a cambiar.
    setDemandas((prev) => prev.map((d) => d.id === demandaId ? { ...d, estado: nuevoEstado } : d))

    // El try envuelve también la excepción de red, no sólo el error que
    // devuelve PostgREST: sin él, una petición que revienta dejaba la pastilla
    // marcada en un estado que en la base de datos nunca llegó a cambiar y sin
    // un aviso en ninguna parte.
    let fallo = false
    try {
      const { error } = await supabase.from("demandas").update({ estado: nuevoEstado }).eq("id", demandaId)
      fallo = Boolean(error)
    } catch {
      fallo = true
    }
    if (fallo) {
      // Se revierte SÓLO si la pastilla sigue en lo que puso esta llamada. Si
      // mientras iba y venía se ha pulsado otro estado, mandar el de antes
      // borraría el clic bueno de quien está mirando la pantalla.
      setDemandas((prev) => prev.map((d) =>
        d.id === demandaId && d.estado === nuevoEstado ? { ...d, estado: anterior ?? d.estado } : d
      ))
      toast.error("No se pudo cambiar el estado de la demanda")
    }
  }

  async function handleDesactivar() {
    if (!selected) return
    // El aviso ya se ha dado en el diálogo. Antes esto era un window.confirm(),
    // que los navegadores incrustados cancelan solos: se pulsaba y no pasaba
    // nada, sin aviso ni error.
    setConfirmDesactivar(false)
    const res = await desactivarPropiedad(selected.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se pudo desactivar la propiedad",
    }))
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
    setConfirmEliminar(false)
    const res = await eliminarPropiedad(selected.id).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se pudo eliminar la propiedad",
    }))
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
    // Con `.catch`, una excepción de la acción también devuelve el botón: sin
    // él, `deletingId` se quedaba con esta demanda y su papelera se quedaba
    // girando y deshabilitada para siempre.
    const res = await eliminarDemanda(demandaId).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se pudo eliminar la demanda",
    }))
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

    // El error ni se miraba: la nota se pintaba en la ficha, el recuadro se
    // cerraba y en la base de datos no se había escrito nada. Y si la petición
    // reventaba, `savingNota` se quedaba en true y el botón "Guardar" no volvía
    // nunca. Ahora el recuadro sólo se cierra si se ha guardado de verdad, para
    // que lo escrito no se pierda al cerrarse.
    try {
      const { error } = await supabase.from("demandas").update({ notas: val }).eq("id", demandaId)
      if (error) {
        toast.error("No se pudo guardar la nota")
        return
      }
      setDemandas((prev) => prev.map((d) => d.id === demandaId ? { ...d, notas: val } : d))
      setEditingDemandId(null)
    } catch {
      toast.error("No se pudo guardar la nota")
    } finally {
      setSavingNota(false)
    }
  }

  /**
   * LA LÍNEA DE DEBAJO DEL TÍTULO.
   *
   * Con corte puesto las dos mitades cambian de significado y por eso cambian de
   * palabras: las propiedades no son "las que hay" sino las que HAN RECIBIDO
   * alguna demanda en el periodo, y las demandas son las de ese periodo — que es
   * justo el número que prometía la tarjeta desde la que se ha llegado. Sin
   * decirlo, un "13 propiedades" donde ayer ponía 1.090 se lee como que falta
   * media base de datos.
   */
  const cuantasProps = total.toLocaleString("es")
  const etiquetaProps = termino
    ? `${cuantasProps} propiedad${total !== 1 ? "es" : ""} encontrada${total !== 1 ? "s" : ""}`
    : desde
      ? `${cuantasProps} propiedad${total !== 1 ? "es" : ""} con demandas en este periodo`
      : `${cuantasProps} propiedades`
  // Con búsqueda no se añade el total de demandas, que es de toda la pantalla y
  // no de lo buscado: "3 propiedades encontradas · 1.825 demandas" se lee como
  // si esas tres tuvieran 1.825.
  const resumen = termino || totalDemandas === null
    ? etiquetaProps
    : `${etiquetaProps} · ${totalDemandas.toLocaleString("es")} demanda${totalDemandas !== 1 ? "s" : ""}`

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: property list ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-8 pb-0 shrink-0 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">Demandas</h1>
              <p className="text-sm text-muted-foreground tabular-nums">
                {loading ? "Cargando..." : resumen}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* LA CHAPA DE LO QUE LLEGA POR LA URL, con su X.
                  No es adorno: un filtro que llega por la URL y no se ve es la
                  forma más rápida de que alguien jure que "faltan demandas". Y
                  soltarla es "verlas todas", que es lo que pidió el dueño. */}
              {desde && (
                <button
                  onClick={quitarDesde}
                  title="Ver todas, sin filtro de fecha"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-border text-muted-foreground font-medium whitespace-nowrap transition-all hover:border-muted-foreground/40"
                >
                  {/* La frase la escribe el servidor con el periodo que venía
                      pulsado, para que diga lo mismo que el botón de la portada. */}
                  {etiquetaDesde || "Con filtro de fecha"}
                  <X className="h-3 w-3 shrink-0 opacity-70" />
                </button>
              )}
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
          </div>
          <div className="border-b border-border" />
        </div>

        <div ref={listaRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : propiedades.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Building2 className="h-7 w-7 text-muted-foreground" />
              </div>
              {/* Un vacío CON CORTE no es "no hay demandas": es que no ha
                  entrado ninguna en ese periodo, y decirlo ahorra el paseo de ir
                  a comprobar si se ha roto algo. La salida está a un clic, y se
                  nombra la chapa para que se sepa cuál pulsar. */}
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  {termino
                    ? "Sin resultados"
                    : desde
                      ? "Ninguna demanda en este periodo"
                      : "Sin demandas todavía"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {termino
                    ? "Prueba con otro término"
                    : desde
                      ? `Estás viendo «${etiquetaDesde || "con filtro de fecha"}». Pulsa esa chapa de arriba para ver todas las propiedades.`
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
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">Ref. {p.ref}</span>
                        {p.tipo && <span className="text-xs text-foreground font-medium">{p.tipo}</span>}
                        {p.accion && <span className="text-xs text-muted-foreground">· {p.accion}</span>}
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">
                        {[p.ciudad, p.zona].filter(Boolean).join(", ") || "Ubicación no disponible"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
              pagina={paginaActual}
              porPagina={POR_PAGINA}
              total={total}
              onCambiar={setPagina}
              cargando={loading}
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
                onClick={cerrarFicha}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Propiedad info */}
            <div className="p-5 border-b border-border flex flex-col gap-3">
              {editando ? (
                <div className="grid grid-cols-2 gap-2">
                  {CAMPOS_EDITABLES.map(({ label, key, numeric }) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <label className="text-[10px] text-muted-foreground">{label}</label>
                      <input
                        type={numeric ? "number" : "text"}
                        value={editFields[key] ?? ""}
                        onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-full h-7 px-2 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 text-xs">
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
              {/* DOS ACCIONES DISCRETAS, no dos botones a media pantalla.

                  Estaban como dos botones del ancho del panel, uno de ellos en
                  rojo, justo encima de las demandas. Lo primero que se veía al
                  abrir una propiedad era "Eliminar propiedad"; lo que se venía
                  a leer —quién ha preguntado por ella— quedaba debajo. Borrar
                  no es lo que se hace aquí cada día, así que no se pinta como
                  si lo fuera. El rojo aparece al pasar por encima, que es
                  cuando hace falta la advertencia. */}
              {!editando && (
                <div className="flex items-center justify-end gap-4 text-xs">
                  <button
                    onClick={() => setConfirmDesactivar(true)}
                    className="text-muted-foreground hover:text-amber-400 transition-colors"
                  >
                    Desactivar
                  </button>
                  <button
                    onClick={() => setConfirmEliminar(true)}
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>

            {/* Demands list */}
            <div className="p-5 flex flex-col gap-4">
              {loadingDemandas ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : demandas.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 italic">
                  {/* Con corte, el vacío de aquí es del PERIODO y no de la
                      propiedad: sin decirlo, una ficha que la lista anuncia con
                      demandas parecería estar rota al abrirse. */}
                  {desde
                    ? "Sin demandas en el periodo filtrado"
                    : "Sin demandas para esta propiedad"}
                </p>
              ) : (
                (() => {
                  // Un grupo por estado, en el orden del catálogo. Antes eran
                  // tres grupos fijos —"Aprobadas", "En proceso" y
                  // "Descartadas"— con "Cualificado" y "Descartado" escritos
                  // aquí dentro: un estado nuevo caía en "En proceso" sin que
                  // nadie lo hubiera decidido, y renombrarlo en el panel no
                  // cambiaba lo que se leía en pantalla. Un estado que no esté
                  // catalogado tampoco desaparece: hace su propio grupo, con su
                  // valor por nombre y en gris, al final de la lista.
                  const posicion = (e: string | null) => {
                    const i = ESTADOS_UI.findIndex((c) => c.valor === e)
                    return i === -1 ? ESTADOS_UI.length : i
                  }
                  const porEstado = new Map<string, Demanda[]>()
                  for (const d of demandas) {
                    const clave = d.estado ?? ""
                    const lista = porEstado.get(clave)
                    if (lista) lista.push(d)
                    else porEstado.set(clave, [d])
                  }
                  const grupos = [...porEstado.entries()]
                    .sort(([a], [b]) => posicion(a) - posicion(b) || a.localeCompare(b))
                  return grupos.map(([estado, items]) => (
                    <div key={estado} className="flex flex-col gap-2">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", clasePunto(colorEstado(estado)))} />
                        {nombreEstado(estado)} ({items.length})
                      </p>
                      {items.map((d) => (
                  <div key={d.id} className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2.5">
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
                      <div className="text-[10px] bg-emerald-500/5 border border-emerald-500/20 rounded p-2 flex flex-col gap-0.5">
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
                      <div className="flex flex-col gap-1.5">
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

                    {/* EL ESTADO: uno, y los demás sólo cuando se van a usar.

                        Aquí se pintaban los cuatro en cada demanda. Con cuatro
                        demandas ya son dieciséis pastillas y sólo cuatro dicen
                        algo; en una propiedad con veinte peticiones, ochenta.
                        Ahora se ve en qué estado está, y al pulsarlo aparecen
                        los otros para moverlo. */}
                    <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border">
                      {estadoAbierto === d.id ? (
                        ESTADOS_UI.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { cambiarEstado(d.id, c.valor); setEstadoAbierto(null) }}
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded border font-medium transition-all",
                              d.estado === c.valor
                                ? claseColor(c.color)
                                : "border-border text-muted-foreground hover:border-muted-foreground/40"
                            )}
                          >
                            {c.nombre}
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() => setEstadoAbierto(d.id)}
                          title="Cambiar el estado"
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded border font-medium transition-all",
                            claseColor(colorEstado(d.estado)),
                          )}
                        >
                          {nombreEstado(d.estado)}
                        </button>
                      )}
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

      <Confirmar
        abierto={confirmDesactivar}
        titulo="¿Desactivar esta propiedad?"
        texto={`La Ref. ${selected?.ref ?? ""} desaparece de la lista. Sus demandas se quedan como están.`}
        confirmar="Sí, desactivar"
        onConfirmar={handleDesactivar}
        onCancelar={() => setConfirmDesactivar(false)}
      />

      <Confirmar
        abierto={confirmEliminar}
        titulo="¿Borrarla para siempre?"
        texto={`Se borra la Ref. ${selected?.ref ?? ""} y sus ${selected?.totalDemandas ?? 0} demandas. Esto no se deshace ni desde la papelera: si sólo quieres que deje de salir, usa Desactivar.`}
        confirmar="Sí, borrar"
        peligro
        onConfirmar={handleEliminarPropiedad}
        onCancelar={() => setConfirmEliminar(false)}
      />
    </div>
  )
}
