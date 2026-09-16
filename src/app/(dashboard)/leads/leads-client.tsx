"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { crearLead, actualizarLead } from "@/lib/actions/leads"
import { asignarLeadsAMano, quitarAgenteLeads } from "@/lib/actions/asignacion"
import { Paginador, POR_PAGINA } from "@/components/shared/paginador"
import { Atendido } from "@/components/shared/atendido"
import { cn } from "@/lib/utils"
import { AlertCircle, Search, X, Plus, UserCircle, Pencil, Check, Loader2, RefreshCw, UserPlus, UserMinus } from "lucide-react"
import { type Catalogo, opcionesDe, nombreDe, colorDe, claseColor, clasePunto } from "@/lib/catalogos"

/**
 * Estados y fuentes vienen del catálogo, no de una lista escrita aquí.
 *
 * Antes eran dos constantes en este fichero, y tenían dos problemas. El visible:
 * un estado creado desde /configuracion/catalogos no salía por ningún lado, que
 * es justo lo contrario de para lo que se hizo la tabla. Y el que no se veía:
 * `ESTADO_CFG[lead.estado].badge` con un estado que no estuviera en el mapa era
 * `undefined.badge`, o sea la pantalla entera en blanco. Bastaba con asignar a
 * un lead un estado nuevo para tirarla.
 *
 * Además las fuentes ni siquiera coincidían: la lista de aquí decía "Manual",
 * "Referido" o "Redes sociales", que no existen en el catálogo, mientras que
 * Instagram o Ficha de propiedad —por donde entran de verdad— no estaban.
 *
 * Un valor que no esté catalogado se sigue pintando: `nombreDe` cae al propio
 * valor y `claseColor` a gris. Una fila vieja con un estado retirado tiene que
 * poder leerse.
 */
type EstadoLead = string

/**
 * Un lead tiene DOS personas detrás, y no son la misma (migración 024):
 *
 *   agente_id   -> quien lo trabaja hoy. Es lo que se traspasa.
 *   captado_por -> quien lo trajo. No se pisa nunca.
 *
 * Hasta hoy esta pantalla leía `captado_por` y lo llamaba "Agente", que era lo
 * único que había. Con el reparto de leads en marcha eso enseñaría al captador
 * de un lead que lleva otro desde hace semanas.
 *
 * Las dos relaciones apuntan a `perfiles`, así que PostgREST no puede adivinar
 * cuál es cuál: hay que nombrarle la clave ajena (`!leads_agente_id_fkey`). Sin
 * la pista contesta un 300 y la lista entera se queda sin cargar.
 */
const COLUMNAS =
  "id, nombre, apellidos, email, telefono, fuente, estado, notas, fecha_creacion, captado_por, captacion_id, agente_id, asignacion_motivo, atendido_en, atendido_por, agente:perfiles!leads_agente_id_fkey(nombre, apellidos), captador:perfiles!leads_captado_por_fkey(nombre, apellidos), atendedor:perfiles!leads_atendido_por_fkey(nombre, apellidos)"

interface Persona {
  nombre: string | null
  apellidos: string | null
}

interface Lead {
  id: string
  nombre: string
  apellidos: string | null
  email: string | null
  telefono: string | null
  fuente: string | null
  estado: EstadoLead
  notas: string | null
  fecha_creacion: string
  captado_por: string | null
  captacion_id: number | null
  agente_id: string | null
  /** Por qué le tocó a quien le tocó, o por qué no le ha tocado a nadie. */
  asignacion_motivo: string | null
  /** Cuándo se habló con esta persona por última vez, y quién habló. */
  atendido_en: string | null
  atendido_por: string | null
  agente: Persona | null
  captador: Persona | null
  atendedor: Persona | null
}

/** Lo que hace falta de cada compañero para poder repartirle un lead. */
interface AgenteOpcion {
  id: string
  nombre: string
}

/** "Nombre Apellidos", sin el hueco suelto cuando falta uno de los dos. */
function nombrePersona(p: Persona | null): string {
  if (!p) return "Sin asignar"
  return `${p.nombre ?? ""} ${p.apellidos ?? ""}`.trim() || "Sin nombre"
}

/**
 * Un embebido de PostgREST llega como objeto o como array de uno según cómo
 * resuelva la relación. Aquí siempre es una persona o ninguna.
 */
function unoSolo(valor: unknown): Persona | null {
  const x = Array.isArray(valor) ? valor[0] : valor
  return (x as Persona | undefined) ?? null
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

export default function LeadsPage({
  catalogos = [],
  fuentesIniciales = [],
  desdeInicial = "",
  etiquetaDesde = "",
  leadInicial = "",
}: {
  catalogos?: Catalogo[]
  /** Las fuentes que pide la URL, ya validadas contra el catálogo por el servidor. */
  fuentesIniciales?: string[]
  /** Desde cuándo, en ISO. Lo calcula la portada con el corte de su periodo. */
  desdeInicial?: string
  /** Y cómo se lee ese corte ("Entrados hoy"), escrito también en el servidor. */
  etiquetaDesde?: string
  /** La ficha que hay que abrir al entrar, si se viene de pulsar una fila. */
  leadInicial?: string
}) {
  // Activos y en orden, tal y como los dejó el administrador en el panel.
  const ESTADOS = opcionesDe(catalogos, "estado_lead")
  const FUENTES = opcionesDe(catalogos, "fuente")

  // Atajos para no repetir el tipo de catálogo en cada sitio donde se pinta.
  const badgeEstado = (e: string) => claseColor(colorDe(catalogos, "estado_lead", e))
  const nombreEstado = (e: string) => nombreDe(catalogos, "estado_lead", e)

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<EstadoLead | "">("")
  /**
   * De dónde vinieron. Llega por la URL (`/leads?fuente=Instagram,Facebook`)
   * desde las tarjetas de la portada, y el servidor ya las ha validado una a una
   * contra el catálogo.
   *
   * VARIAS y no una: cada tarjeta cuenta una FAMILIA de fuentes —Instagram y
   * Facebook son la misma pregunta— y el filtro tiene que poder enseñar
   * exactamente las mismas filas que ha contado el número, o la tarjeta promete
   * una cosa y la lista enseña otra.
   *
   * No lleva una fila de pastillas propia como el estado: serían ocho más, casi
   * todas a cero para casi todos, y es justo lo que se está quitando de las
   * pantallas. Cuando hay filtro se enseña una chapa que se puede quitar, y
   * cuando no hay, no se ve nada.
   */
  const [fuentes, setFuentes] = useState<string[]>(fuentesIniciales)
  /**
   * DESDE CUÁNDO, el corte del periodo que el agente tenía puesto en su portada.
   *
   * Llega hecho del servidor, que lo ha calculado con el mismo corte con el que
   * contó el número de la tarjeta: pulsar una tarjeta que dice 3 con "Hoy"
   * enseña esos 3, no los 121 de siempre. Se quita con su chapa, y quitarlo es
   * "verlos todos".
   */
  const [desde, setDesde] = useState<string>(desdeInicial)
  /**
   * UNA FICHA CONCRETA: la fila de "lo que toca hoy" que se acaba de pulsar.
   *
   * Filtra la consulta además de abrir el panel, y las dos cosas por el mismo
   * motivo: la lista va paginada de 50 en 50 y ordenada por fecha, así que el
   * lead que toca llamar —que suele ser de los viejos— no tiene por qué estar en
   * la página que se carga. Filtrando, está siempre.
   */
  const [leadFilter, setLeadFilter] = useState<string>(leadInicial)
  /** El filtro de "esto no lo está trabajando nadie". */
  const [soloSinAsignar, setSoloSinAsignar] = useState(false)
  const [pagina, setPagina] = useState(1)
  /** Total real de leads que cumplen el filtro, contado en la base de datos. */
  const [total, setTotal] = useState(0)
  /**
   * Cuántos de los que se están mirando no tienen agente. `null` es "no se ha
   * podido contar" y NO se pinta: un 0 se lee como "ya está todo repartido",
   * que es justo lo contrario de lo que estaría pasando.
   */
  const [sinAsignar, setSinAsignar] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  // `abierto` guarda CUÁL ficha está abierta; `selected` es esa misma ficha
  // pero leída de `leads`, que es la lista que se recarga. Mantenerlas juntas en
  // un solo estado dejaba el panel congelado en la copia del momento en que se
  // pinchó la fila: al pulsar "Atendido", la fila pasaba a "Interesado" y el
  // panel seguía marcando "Nuevo", sobre el mismo lead y al mismo tiempo.
  const [abierto, setSelected] = useState<Lead | null>(null)
  /**
   * Y la que abre la URL, sin haber pulsado nada.
   *
   * Es un VALOR DERIVADO, no un estado que alguien rellene en un efecto: el lint
   * del compilador rechaza setState dentro de useEffect, y aquí además sobra.
   * Mientras el filtro de un solo lead siga puesto, la lista tiene exactamente
   * esa fila y el panel se abre solo con ella.
   */
  const selected = abierto
    ? (leads.find((l) => l.id === abierto.id) ?? abierto)
    : leadFilter
      ? leads.find((l) => l.id === leadFilter) ?? null
      : null
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // El equipo, para repartir desde la ficha. `null` mientras no se ha traído:
  // así una lista vacía por un fallo de carga no se confunde con "aún viene".
  const [agentes, setAgentes] = useState<AgenteOpcion[] | null>(null)
  /** Id del agente al que se está traspasando ahora mismo. */
  const [asignando, setAsignando] = useState<string | null>(null)
  /** Si se está quitando el agente del lead abierto ahora mismo. */
  const [quitando, setQuitando] = useState(false)

  // Panel edición inline
  const [editando, setEditando] = useState(false)
  const [editTel, setEditTel] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editNotas, setEditNotas] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  // Modal nuevo lead
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const supabase = createClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Número de la última carga pedida. Ver `peticion` dentro de fetchLeads. */
  const peticionRef = useRef(0)
  /** Para no repetir el aviso de "lista de captaciones cortada" en cada tecla. */
  const avisoCapsRef = useRef(false)

  /**
   * Trae UNA página de leads y, con ella, el total de verdad.
   *
   * El total sale de { count: "exact" } — PostgREST lo manda en la cabecera
   * Content-Range — y no de contar las filas traídas, que dirían siempre 50.
   * Antes esto pedía .limit(500) sobre 1.042 leads: faltaban quinientos y la
   * pantalla no decía ni pío.
   */
  const fetchLeads = useCallback(async (uid: string, admin: boolean, pag: number) => {
    // Dos cargas pueden estar en el aire a la vez: tecleas mientras vuelve la
    // anterior, o entra un lead por realtime justo cuando cambias de página. Sin
    // esto, la respuesta lenta de "car" pinta encima de la de "carlos" y acabas
    // viendo una lista que no corresponde a lo que pone el buscador. Sólo la
    // última carga pedida tiene permiso para tocar el estado.
    const peticion = ++peticionRef.current
    const vigente = () => peticion === peticionRef.current

    setLoading(true)

    // Una consulta que falla no es una lista vacía. Hasta ahora el error se
    // tragaba en silencio y la pantalla ponía "Aún no tienes leads" con la base
    // de datos llena, que es la peor manera posible de equivocarse.
    const fallar = (mensaje: string) => {
      if (!vigente()) return
      setErrorCarga(mensaje)
      setLeads([])
      setTotal(0)
      // El recuento de sin asignar tampoco vale ya: dejarlo puesto sobre una
      // pantalla de error es enseñar el número de una lista que no se ha leído.
      setSinAsignar(null)
      toast.error("No se han podido cargar los leads")
    }

    try {
      let capIds: number[] = []
      if (!admin) {
        // El tope se pide explícito porque PostgREST corta en 1.000 filas EN
        // SILENCIO y con un 200 OK. Si un agente pasara de mil captaciones, la
        // lista de ids llegaría cortada, sus leads espejo desaparecerían de la
        // pantalla y nada fallaría: exactamente la clase de mentira que no nos
        // podemos permitir aquí. Hoy no llega —737 captaciones activas en toda
        // la empresa—, así que se avisa en vez de reescribir el filtro: la
        // solución de verdad es una vista o una RPC en la base, porque un
        // `in.(...)` con mil ids tampoco cabe en la URL.
        const TOPE_CAPS = 1000
        const { data: caps, error: errorCaps } = await supabase
          .from("captaciones")
          .select("id")
          .eq("agente_id", uid)
          .limit(TOPE_CAPS)
        // Si esta falla y la damos por vacía, el agente deja de ver los leads de
        // sus captaciones y la lista parece correcta: hay que decirlo.
        if (errorCaps) {
          fallar(errorCaps.message)
          return
        }
        capIds = (caps ?? []).map((c: { id: number }) => c.id)
        if (capIds.length >= TOPE_CAPS && !avisoCapsRef.current) {
          avisoCapsRef.current = true
          toast.error("Tienes más de 1.000 captaciones: puede que falten leads en esta lista. Avisa al administrador.")
        }
      }

      // La consulta se construye más de una vez —la página y, si hace falta, el
      // recuento de rescate de más abajo— porque un constructor de supabase-js
      // no se puede reutilizar una vez lanzado.
      // Genérica en las columnas: supabase-js deduce el tipo de `data` del
      // literal del select, y con un `string` a secas lo da por fallido.
      const construir = <C extends string>(columnas: C, head = false, sinAgente = soloSinAsignar) => {
        let q = supabase.from("leads").select(columnas, { count: "exact", head })

        if (!admin) {
          // "Los suyos" es `agente_id`, el que lo trabaja, y no `captado_por`.
          // Desde la 024 un traspaso mueve el primero y deja el segundo quieto:
          // filtrando por el captador, el agente que perdió un lead lo seguiría
          // viendo en su lista. Los espejos de sus propias captaciones siguen
          // entrando por `captacion_id`, que es como los ve hoy.
          if (capIds.length > 0) {
            q = q.or(`agente_id.eq.${uid},captacion_id.in.(${capIds.join(",")})`)
          } else {
            q = q.eq("agente_id", uid)
          }
        }

        // Sin agente = sin nadie trabajándolo. Se mira `agente_id` y no
        // `captado_por` por lo mismo de arriba: un lead que trajo alguien y que
        // hoy no lleva nadie está sin asignar, por mucho captador que tenga.
        if (sinAgente) q = q.is("agente_id", null)

        if (estadoFilter) q = q.eq("estado", estadoFilter)

        // El origen es una columna, no una relación: se filtra igual que el
        // estado. Los valores ya vienen comprobados contra el catálogo.
        //
        // `.in` y no `.eq` aunque venga una sola: una tarjeta de la portada
        // manda su familia entera (Instagram · Facebook · RRSS · Redes) y con
        // `.eq` sólo habría entrado la primera, o sea que el número de la
        // tarjeta y el total de aquí no habrían cuadrado nunca.
        if (fuentes.length > 0) q = q.in("fuente", fuentes)

        // Desde cuándo. El corte llega en ISO y ya normalizado por el servidor,
        // y es EL MISMO instante con el que la portada contó el número.
        if (desde) q = q.gte("fecha_creacion", desde)

        // Una ficha concreta. Va con los demás filtros a propósito: el total del
        // paginador, el recuento de sin asignar y la propia fila salen todos de
        // esta misma consulta, así que la pantalla sigue siendo coherente
        // consigo misma mientras dure el filtro.
        if (leadFilter) q = q.eq("id", leadFilter)

        // El valor va entre comillas: PostgREST parte el `or` por comas y
        // paréntesis, así que buscar "Pérez, Juan" sin ellas rompe el filtro y
        // devuelve un 400. Dentro de las comillas, la barra y la comilla son el
        // escape, y no hay nada que buscar con ellas en un nombre o un teléfono.
        const termino = search.trim().replace(/["\\]/g, "")
        if (termino) {
          q = q.or(
            `nombre.ilike."%${termino}%",apellidos.ilike."%${termino}%",telefono.ilike."%${termino}%"`,
          )
        }

        return q
      }

      // Se llama `primeraFila` y no `desde` porque en este mismo bloque vive
      // `construir`, que usa el `desde` del componente —el corte de fecha que
      // llega por la URL—. Un `const desde` aquí lo tapaba por alcance léxico y
      // el filtro de fecha acababa recibiendo el número de fila: en la página 1
      // valía 0, o sea que no se filtraba nada y la tarjeta que prometía 3
      // enseñaba los 1.090; en la 2 se preguntaba por `fecha_creacion >= 50` y
      // la pantalla se iba al error de carga. TypeScript no lo canta porque los
      // dos son valores válidos para `.gte()`.
      const primeraFila = (pag - 1) * POR_PAGINA
      // Las dos a la vez: la página y cuántos de esos mismos leads están sin
      // repartir. El recuento se hace EN LA BASE con head:true —sólo viaja la
      // cabecera con el total, ni una fila—, porque contar los sin agente sobre
      // las 50 filas cargadas diría "12" habiendo ciento treinta y seis.
      const [{ data, error, count }, conteoSin] = await Promise.all([
        construir(COLUMNAS)
          .order("fecha_creacion", { ascending: false })
          .range(primeraFila, primeraFila + POR_PAGINA - 1),
        construir("id", true, true),
      ])

      if (!vigente()) return

      // Si el recuento falla se queda en null y la pastilla sale sin número.
      setSinAsignar(conteoSin.error ? null : conteoSin.count ?? null)

      if (error) {
        // Pedir un rango que empieza más allá del total NO devuelve una lista
        // vacía: PostgREST contesta 416 y supabase-js lo entrega como error, sin
        // `count`. Pasa al borrar o reasignar leads mientras miras una página
        // alta. No es un fallo de carga y no debe enseñar la pantalla roja: se
        // baja a la última página que exista. El total hay que preguntarlo
        // aparte justo porque el 416 no lo trae.
        if ((error as { code?: string }).code === "PGRST103" && pag > 1) {
          const { count: real } = await construir("id", true)
          if (!vigente()) return
          setErrorCarga(null)
          setPagina(Math.max(1, Math.ceil((real ?? 0) / POR_PAGINA)))
          return
        }
        fallar(error.message)
        return
      }

      const totalReal = count ?? 0
      setTotal(totalReal)

      // Misma caída de página que arriba, para cuando el servidor sí responde
      // 200 con un total por debajo de la página pedida.
      const paginas = Math.max(1, Math.ceil(totalReal / POR_PAGINA))
      if (pag > paginas) {
        setErrorCarga(null)
        setPagina(paginas)
        return
      }

      const normalized = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        agente: unoSolo(row.agente),
        captador: unoSolo(row.captador),
      }))
      setLeads(normalized as Lead[])
      setErrorCarga(null)
    } catch (e) {
      fallar(e instanceof Error ? e.message : "No hay conexión con el servidor")
    } finally {
      // Si ya hay otra carga en marcha, quitar el "Cargando..." desde aquí haría
      // parpadear la lista vieja antes de que llegue la buena.
      if (vigente()) setLoading(false)
    }
  }, [estadoFilter, fuentes, desde, leadFilter, search, soloSinAsignar])

  // Init: auth + datos iniciales (una sola vez)
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // Sin sesión no hay nada que pedir, pero dejarlo aquí sin más deja la
        // pantalla en "Cargando leads..." para siempre, que se lee como "esto
        // va lento" cuando lo que pasa es que hay que volver a entrar.
        setLoading(false)
        setErrorCarga("Tu sesión ha caducado. Vuelve a entrar.")
        return
      }
      const { data: perfil, error: errorPerfil } = await supabase
        .from("perfiles").select("rol").eq("id", user.id).single()
      // Un fallo aquí NO puede pasar por "no eres administrador" en silencio: el
      // dueño se quedaría viendo sólo los leads que lleva él y daría por hecho
      // que se han perdido los demás. Se degrada al ámbito de agente —que es el
      // lado seguro— pero contándolo.
      if (errorPerfil) toast.error("No se ha podido comprobar tu rol: verás sólo tus leads")
      const admin = perfil?.rol === "Admin"
      setIsAdmin(admin)
      setUserId(user.id)
      // No llamamos fetchLeads aquí: el efecto de abajo se dispara al cambiar userId

      // El equipo sólo hace falta para repartir, y repartir sólo lo hace el
      // administrador: al agente no se le pide esta lista para nada.
      if (!admin) return

      // Se pide aquí y no con `getAgentes()` a propósito: esa función se traga
      // el error de la consulta y devuelve `[]` (`const { data } = ...; return
      // data ?? []`), así que un fallo de red llegaría hasta la ficha disfrazado
      // de "no hay agentes a los que repartir". Es la misma trampa que un
      // contador que devuelve 0 cuando en realidad no ha podido contar. Pidiendo
      // la consulta desde aquí sí se distingue una cosa de la otra.
      //
      // `.neq("rol", "Admin")` es el mismo filtro que usa el panel de reparto y
      // el mismo que aplica `siguiente_agente()` (`p.rol <> 'Admin'`): el
      // administrador no entra en la rotación, así que tampoco se ofrece para
      // repartirle a mano.
      const { data: equipo, error: errorEquipo } = await supabase
        .from("perfiles")
        .select("id, nombre, apellidos")
        .neq("rol", "Admin")
        .order("nombre")
      if (errorEquipo) {
        // Lista vacía Y aviso: sin el aviso, la ficha enseñaría un hueco donde
        // van los compañeros y parecería que la empresa no tiene agentes.
        setAgentes([])
        toast.error("No se ha podido cargar el equipo")
        return
      }
      setAgentes((equipo ?? []).map((a) => ({ id: a.id as string, nombre: nombrePersona(a) })))
    }
    // Si esto revienta, el usuario se queda sin rol y sin `userId`, así que el
    // efecto de carga no llega a dispararse nunca: hay que apagar el "Cargando"
    // a mano y contarlo, o la pantalla se queda girando para siempre.
    init().catch(() => {
      setLoading(false)
      setErrorCarga("No se ha podido comprobar tu sesión")
      toast.error("No se ha podido comprobar tu sesión")
    })
  }, [])

  // Refetch al cambiar filtros, página o al tener userId; debounce solo para búsqueda de texto
  useEffect(() => {
    if (userId === null) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const delay = search ? 300 : 0
    debounceRef.current = setTimeout(() => fetchLeads(userId, isAdmin, pagina), delay)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [estadoFilter, fuentes, desde, leadFilter, search, soloSinAsignar, fetchLeads, userId, isAdmin, pagina])

  // La página que se está mirando, en una ref: el canal de realtime se monta una
  // vez y así la lee sin tener que resuscribirse cada vez que pasas de página.
  const paginaRef = useRef(pagina)
  useEffect(() => { paginaRef.current = pagina }, [pagina])

  // Y lo mismo con fetchLeads, que cambia de identidad con cada tecla del
  // buscador: si el efecto del canal dependiera de ella, cada pulsación
  // desmontaría y volvería a montar la suscripción, y en ese hueco los INSERT
  // que lleguen se pierden.
  const fetchRef = useRef(fetchLeads)
  useEffect(() => { fetchRef.current = fetchLeads }, [fetchLeads])

  // Al cambiar de página la lista vuelve arriba; si no, aterrizas en mitad de la
  // página nueva. Depende sólo de `pagina`, así que una recarga por realtime —
  // que no la toca — no te mueve el scroll de donde lo tenías.
  const listaRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listaRef.current?.scrollTo({ top: 0 }) }, [pagina])

  /**
   * Leads nuevos, en vivo.
   *
   * Hasta ahora la lista se pedía una sola vez al abrir la pantalla, así que un
   * lead que entrara con la pestaña abierta no aparecía nunca — por mucho que
   * el aviso por correo hubiera llegado hacía media hora. Pasó de verdad el
   * 14/09/2026 con un lead de la ficha de propiedad: estaba en la base de datos
   * y la pantalla no lo enseñaba.
   *
   * Se recarga la lista en vez de insertar la fila suelta porque el filtro, el
   * buscador y el agente asociado los resuelve la consulta: añadirla a mano aquí
   * significaría reimplementar todo eso en el cliente y acabar enseñando leads
   * que el filtro activo debería esconder.
   *
   * Recarga LA PÁGINA QUE ESTÁS MIRANDO, nunca la primera: si estás repasando la
   * página 3 y entra un lead, saltar a la 1 te quita de las manos lo que estabas
   * leyendo. Tampoco puede dejarte en una página inexistente: un INSERT sólo
   * hace crecer el total, y si aun así se fuera de rango, fetchLeads baja sola a
   * la última página que exista. Lo que sí ocurre es que el lead nuevo entra el
   * primero y corre una fila a todo lo demás — es inherente a paginar por rango,
   * y a cambio el total del paginador se actualiza en esa misma consulta.
   */
  useEffect(() => {
    if (userId === null) return
    const canal = supabase
      .channel("leads-nuevos")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, () => {
        fetchRef.current(userId, isAdmin, paginaRef.current)
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [userId, isAdmin])

  // Cualquier cambio de filtro o de búsqueda vuelve a la página 1: si estás en la
  // 9 y filtras por algo que da veinte resultados, te quedas mirando el vacío.
  function filtrarPor(estado: EstadoLead | "") {
    setEstadoFilter(estado)
    setPagina(1)
  }

  function buscar(texto: string) {
    setSearch(texto)
    setPagina(1)
  }

  function quitarFuente() {
    setFuentes([])
    setPagina(1)
  }

  /** "Y enséñamelos todos, no sólo los de ese periodo." */
  function quitarDesde() {
    setDesde("")
    setPagina(1)
  }

  /**
   * Soltar la ficha que abrió la URL y volver a ver la lista entera.
   *
   * Cierra el panel Y quita el filtro de un solo lead, que son la misma acción:
   * mientras el filtro esté puesto la lista tiene una fila, así que dejar el
   * panel cerrado sobre una lista de uno no sería "cerrar", sería un callejón.
   */
  function verTodos() {
    setLeadFilter("")
    setSelected(null)
    setEditando(false)
    setPagina(1)
  }

  /**
   * Abrir (o cerrar) una ficha pulsando una fila.
   *
   * Pulsar manda sobre la URL: en cuanto el agente toca la lista, el filtro de
   * un solo lead se suelta. Si no, cerrar la ficha que abrió la URL no cerraría
   * nada —el valor derivado la volvería a abrir en el mismo render—.
   */
  function abrirFicha(lead: Lead | null) {
    if (leadFilter) {
      setLeadFilter("")
      setPagina(1)
    }
    setSelected(lead)
    setEditando(false)
  }

  function filtrarSinAsignar() {
    setSoloSinAsignar((v) => !v)
    setPagina(1)
  }

  /** Hay algo filtrando: cambia lo que dice la pantalla cuando no sale nada. */
  const hayFiltros =
    !!search || !!estadoFilter || fuentes.length > 0 || !!desde || !!leadFilter || soloSinAsignar

  /**
   * Traspasar el lead abierto a un compañero.
   *
   * Lo escribe la acción de servidor y no un update suelto contra la tabla a
   * propósito: ahí es donde se comprueba el permiso y donde se deja `captado_por`
   * en paz —quien lo trajo no cambia porque hoy lo lleve otro— además de apuntar
   * el motivo del traspaso.
   */
  async function asignarA(agenteId: string, nombreAgente: string) {
    const lead = selected
    // También mientras se está quitando: son la misma columna, y dos peticiones
    // pisándose dejan en pantalla lo que contestó la más lenta.
    if (!lead || asignando || quitando) return
    setAsignando(agenteId)

    // .catch y no sólo try/finally: si la acción revienta por lo que sea, el
    // botón tiene que volver a su sitio y contarlo, no quedarse girando.
    const res = await asignarLeadsAMano([lead.id], agenteId).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se ha podido asignar el lead",
    }))
    setAsignando(null)

    if (res?.error) {
      toast.error(res.error)
      return
    }

    // Se pinta ya lo que acaba de pasar y detrás se vuelve a pedir la página: el
    // filtro "Sin asignar" y su recuento los resuelve la consulta, así que este
    // lead tiene que desaparecer solo de la lista si ya no le toca estar ahí.
    const conAgente: Lead = {
      ...lead,
      agente_id: agenteId,
      agente: { nombre: nombreAgente, apellidos: null },
    }
    // Sólo si el panel sigue enseñando ESTE lead: entre la petición y la
    // respuesta se puede haber cerrado la ficha o abierto otra, y escribirle
    // encima el lead viejo sería enseñar en pantalla algo que no has pedido.
    setSelected((prev) => (prev && prev.id === lead.id ? conAgente : prev))
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? conAgente : l)))
    toast.success(`Lead asignado a ${nombreAgente}`)
    if (userId) fetchLeads(userId, isAdmin, pagina)
  }

  /**
   * Dejar el lead sin agente.
   *
   * Es lo contrario de `asignarA` y NO es un rechazo: el administrador lo
   * recoge para repartirlo de otra forma, así que el agente sigue pudiendo
   * volver a recibirlo (ver `quitarAgenteLeads`). Hasta ahora esto sólo se
   * podía hacer con un script contra la base: en la rejilla de abajo el agente
   * que lo lleva sale deshabilitado, así que ni volviendo a pulsarlo se soltaba.
   *
   * No lleva confirmación a propósito: tiene vuelta atrás de un clic, porque la
   * rejilla de agentes se queda justo debajo para volver a dárselo a quien sea.
   */
  async function quitarAgente() {
    const lead = selected
    if (!lead || !lead.agente_id || asignando || quitando) return
    setQuitando(true)

    // Igual que en asignarA: si la acción revienta, el botón vuelve a su sitio
    // y lo cuenta, en vez de quedarse girando.
    const res: { ok?: true; motivo?: string; error?: string } = await quitarAgenteLeads([lead.id])
      .catch((e: unknown) => ({
        error: e instanceof Error ? e.message : "No se ha podido quitar el agente",
      }))
    setQuitando(false)

    if (res?.error) {
      toast.error(res.error)
      return
    }

    // Se pinta ya el hueco CON su motivo —la firma que acaba de escribir el
    // servidor, no el motivo viejo—, y detrás se vuelve a pedir la página: si
    // está puesto el filtro "Sin asignar", este lead tiene que aparecer en él.
    const sinAgente: Lead = {
      ...lead,
      agente_id: null,
      agente: null,
      asignacion_motivo: res.motivo ?? lead.asignacion_motivo,
    }
    setSelected((prev) => (prev && prev.id === lead.id ? sinAgente : prev))
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? sinAgente : l)))
    toast.success("Lead sin asignar. Puedes dárselo a otro agente aquí mismo.")
    if (userId) fetchLeads(userId, isAdmin, pagina)
  }

  function abrirEdicion() {
    if (!selected) return
    setEditTel(selected.telefono ?? "")
    setEditEmail(selected.email ?? "")
    setEditNotas(selected.notas ?? "")
    setEditando(true)
  }

  /**
   * Guardar teléfono, email y notas.
   *
   * Antes esto hacía `if (res.error) return` a secas: la acción fallaba, el
   * panel se quedaba en modo edición sin decir nada y el usuario volvía a
   * pulsar Guardar pensando que no había llegado a pulsarlo. Y sin `.catch`,
   * una promesa rechazada se llevaba por delante el `setSavingEdit(false)` y
   * dejaba el botón girando para siempre.
   */
  async function guardarEdicion() {
    if (!selected || savingEdit) return
    const leadId = selected.id
    const cambios = {
      telefono: editTel.trim() || null,
      email: editEmail.trim() || null,
      notas: editNotas.trim() || null,
    }
    setSavingEdit(true)
    try {
      const res = await actualizarLead(leadId, cambios)
      if (res.error) {
        toast.error(res.error)
        return
      }
      // Con la ficha que haya abierta AHORA, no con la de hace medio segundo.
      setSelected((prev) => (prev && prev.id === leadId ? { ...prev, ...cambios } : prev))
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...cambios } : l)))
      setEditando(false)
    } catch {
      toast.error("No se han podido guardar los cambios")
    } finally {
      setSavingEdit(false)
    }
  }

  /**
   * Mover el lead de estado.
   *
   * La escritura se comprueba. Antes se pintaba el estado nuevo pasara lo que
   * pasara con la update, así que un fallo dejaba la pantalla diciendo "Ganado"
   * con la base de datos diciendo "Nuevo" — y nadie se enteraba hasta que el
   * lead reaparecía donde no tocaba. El `catch` está por el mismo motivo que en
   * el resto del fichero: sin él, una promesa rechazada dejaba `updatingId`
   * puesto y los botones de estado deshabilitados hasta recargar la página.
   */
  async function cambiarEstado(leadId: string, nuevoEstado: EstadoLead) {
    if (updatingId) return
    setUpdatingId(leadId)
    try {
      const { error } = await supabase.from("leads").update({ estado: nuevoEstado }).eq("id", leadId)
      if (error) {
        toast.error(`No se ha podido cambiar el estado: ${error.message}`)
        return
      }
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, estado: nuevoEstado } : l)))
      setSelected((prev) => (prev && prev.id === leadId ? { ...prev, estado: nuevoEstado } : prev))
    } catch {
      toast.error("No se ha podido cambiar el estado: no hay conexión con el servidor")
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleCrearLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    // `currentTarget` se lee ANTES del await: React lo deja a null al reciclar
    // el evento y después ya no hay formulario del que sacar los datos.
    const fd = new FormData(e.currentTarget)
    try {
      const result = await crearLead(fd)
      if (result.error) {
        setSaveError(result.error)
        return
      }
      setShowModal(false)
      formRef.current?.reset()
      // El lead recién creado entra el primero (orden por fecha desc): si estabas
      // en otra página no lo verías, así que volvemos a la primera. Cambiar de
      // página ya dispara la recarga; si ya estabas en la 1, hay que pedirla.
      if (pagina !== 1) setPagina(1)
      else if (userId) fetchLeads(userId, isAdmin, 1)
    } catch {
      // Sin esto el botón se quedaba en "Guardando..." para siempre.
      setSaveError("No se ha podido crear el lead. Inténtalo otra vez.")
    } finally {
      setSaving(false)
    }
  }

  // Las pastillas ya no llevan número. Se contaba sobre las filas cargadas, así
  // que ahora pondría "Ganado 3" mirando 50 de 1.042: un número que miente es
  // exactamente lo que este paginador viene a quitar de en medio. El total real,
  // contado en la base de datos, está en la cabecera y en el paginador.

  return (
    <div className="flex h-full overflow-hidden p-7 gap-5">

      {/* ── Left: main list ── */}
      <div className="flex-1 flex flex-col min-w-0 gap-5 overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between shrink-0">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">
              {isAdmin ? "Leads" : "Mis leads"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Cargando..."
                : errorCarga
                  ? "No se ha podido cargar la lista"
                  : `${total.toLocaleString("es")} ${total === 1 ? "lead" : "leads"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => buscar(e.target.value)}
                className="pl-8 pr-3 h-9 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-48"
              />
            </div>
            <button
              onClick={() => { setShowModal(true); setSaveError(null) }}
              className="h-9 flex items-center gap-1.5 px-3 text-sm rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo lead
            </button>
          </div>
        </div>

        {/* Pills filtro estado */}
        <div className="flex items-center gap-2 overflow-x-auto shrink-0">
          {/* LAS TRES CHAPAS DE LO QUE LLEGA POR LA URL: de dónde vienen, desde
              cuándo, y si se está mirando una ficha suelta.

              Sólo aparecen si se ha llegado filtrando desde la portada. Las tres
              llevan su X, y no es adorno: un filtro que llega por la URL y no se
              ve es la forma más rápida de que alguien jure que "faltan leads". Y
              es además lo que pidió el dueño —"con la opción de volver a verlas
              todas"—, una por cada cosa que se ha filtrado, para poder soltarlas
              de una en una. */}
          {fuentes.length > 0 && (
            <button
              onClick={quitarFuente}
              title="Quitar el filtro de origen"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
                // Con UNA fuente la chapa se pinta de su color, como siempre.
                // Con varias no hay un color que las represente —la tarjeta de
                // redes trae cuatro— y se queda neutra: teñirla del color de la
                // primera diría que el filtro es sólo ésa.
                fuentes.length === 1
                  ? claseColor(colorDe(catalogos, "fuente", fuentes[0]))
                  : "border-border text-muted-foreground",
              )}
            >
              {fuentes.map((f) => (
                <span key={f} className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(colorDe(catalogos, "fuente", f)))} />
                  {nombreDe(catalogos, "fuente", f)}
                </span>
              ))}
              <X className="h-3 w-3 shrink-0 opacity-70" />
            </button>
          )}
          {desde && (
            <button
              onClick={quitarDesde}
              title="Ver todos, sin filtro de fecha"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-border text-muted-foreground font-medium whitespace-nowrap transition-all hover:border-muted-foreground/40"
            >
              {/* La frase la escribe el servidor con el periodo que venía
                  pulsado, para que diga lo mismo que el botón de la portada. */}
              {etiquetaDesde || "Con filtro de fecha"}
              <X className="h-3 w-3 shrink-0 opacity-70" />
            </button>
          )}
          {leadFilter && (
            <button
              onClick={verTodos}
              title="Volver a ver todos tus leads"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-border text-muted-foreground font-medium whitespace-nowrap transition-all hover:border-muted-foreground/40"
            >
              Un solo lead · ver todos
              <X className="h-3 w-3 shrink-0 opacity-70" />
            </button>
          )}
          <button
            onClick={() => filtrarPor("")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
              estadoFilter === "" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            Todos
          </button>
          {ESTADOS.map(({ valor: e, nombre, color }) => (
            <button
              key={e}
              onClick={() => filtrarPor(estadoFilter === e ? "" : e)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
                estadoFilter === e ? claseColor(color) : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(color))} />
              {nombre}
            </button>
          ))}

          {/* Los que no está trabajando nadie. El número sale de un count exacto
              contra la base —no de las filas cargadas—, y si ese recuento falla
              no se pinta ninguno: un 0 se leería como "ya está todo repartido".

              SÓLO PARA EL ADMINISTRADOR. Un agente ve su propia lista —la
              consulta de arriba filtra por `agente_id`—, así que "sin asignar"
              dentro de lo suyo no puede dar más que cero: es una pastilla que no
              puede hacer nada, que es exactamente lo que se está quitando de las
              pantallas. Repartir es trabajo del que dirige, y él sí la necesita:
              hoy hay 1.011 leads sin dueño. */}
          {isAdmin && (
            <button
              onClick={filtrarSinAsignar}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all",
                soloSinAsignar
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Sin asignar
              {sinAsignar !== null && (
                <span className="tabular-nums opacity-70">{sinAsignar.toLocaleString("es")}</span>
              )}
            </button>
          )}
        </div>

        {/* List card */}
        <div ref={listaRef} className="flex-1 rounded-xl border border-border bg-card overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando leads...</div>
          ) : errorCarga ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">No se han podido cargar los leads</p>
                <p className="text-xs text-muted-foreground">{errorCarga}</p>
              </div>
              <button
                // Sin `userId` no hay nada que volver a pedir —la sesión no ha
                // llegado a resolverse—, así que reintentar es recargar. Si no,
                // este botón no haría absolutamente nada al pulsarlo.
                onClick={() => { if (userId) fetchLeads(userId, isAdmin, pagina); else window.location.reload() }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reintentar
              </button>
            </div>
          ) : leads.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <UserCircle className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  {/* Venir de una fila del día y no encontrar la ficha no es
                      "no hay leads con estos filtros": es que ese lead ya no
                      está en tu lista, y decirlo así ahorra el paseo de
                      comprobar los filtros uno a uno. */}
                  {leadFilter
                    ? "Ese lead ya no está en tu lista"
                    : hayFiltros ? "No hay leads con estos filtros" : "Aún no tienes leads"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {leadFilter
                    ? "Puede que se lo hayan traspasado a otro compañero. Pulsa «Un solo lead · ver todos» para volver a tu lista."
                    : hayFiltros
                      ? soloSinAsignar
                        ? "Ninguno de los leads que ves está esperando agente"
                        : "Prueba cambiando los filtros de búsqueda"
                      : "Los leads se crean automáticamente cuando un propietario responde, o puedes añadir uno manualmente"}
                </p>
              </div>
              {!hayFiltros && (
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-4 w-4" />
                  Crear primer lead
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => abrirFicha(selected?.id === lead.id ? null : lead)}
                  className={cn(
                    "w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-muted/40",
                    selected?.id === lead.id && "bg-muted/60",
                  )}
                >
                  <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                    {lead.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.nombre}{lead.apellidos ? ` ${lead.apellidos}` : ""}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {lead.telefono && <span>{lead.telefono}</span>}
                      {lead.fuente && <span className="opacity-60">· {nombreDe(catalogos, "fuente", lead.fuente)}</span>}
                      {/* En pantalla estrecha no cabe la chapa de la derecha, así
                          que de quién es el lead se dice aquí. */}
                      <span className="sm:hidden opacity-60">· {nombrePersona(lead.agente)}</span>
                    </div>
                  </div>
                  {/* De quién es. Se pinta también para el agente, no sólo para el
                      administrador: en su lista salen los espejos de sus propias
                      captaciones, que pueden estar todavía sin repartir. */}
                  <span
                    className={cn(
                      "hidden sm:flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium shrink-0 max-w-[9rem]",
                      lead.agente
                        ? "border-border text-muted-foreground"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-300",
                    )}
                  >
                    <UserCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate">{nombrePersona(lead.agente)}</span>
                  </span>
                  <span className={cn("text-xs px-2 py-0.5 rounded border font-medium shrink-0", badgeEstado(lead.estado))}>
                    {nombreEstado(lead.estado)}
                  </span>
                  <span className="text-xs text-muted-foreground/50 w-8 text-right shrink-0 hidden sm:block">
                    {timeAgo(lead.fecha_creacion)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Paginador
          pagina={pagina}
          porPagina={POR_PAGINA}
          total={total}
          onCambiar={setPagina}
          cargando={loading}
          className="shrink-0"
        />
      </div>

      {/* ── Right: detail panel ──
          `selected` dice CUÁL está abierto; lo que se pinta sale de `leads`, que
          es la lista fresca. Guardados aparte, la ficha se quedaba con la copia
          del momento en que se pinchó la fila: al pulsar "Atendido" la fila de
          la izquierda pasaba a "Interesado" y el panel de la derecha seguía
          marcando "Nuevo", sobre el mismo lead y a la vez.

          Valor derivado en el render, sin efecto ni setState: el lint de la casa
          rechaza setState dentro de useEffect, y aquí además sobra. El `??
          selected` es para el hueco entre que se recarga la lista y llega: mejor
          el dato de hace un segundo que un panel que desaparece. */}
      {selected && (
        <div className="w-80 shrink-0 rounded-xl border border-border bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Detalle</h2>
            <div className="flex items-center gap-2">
              {!editando ? (
                <button onClick={abrirEdicion} className="text-muted-foreground hover:text-foreground transition-colors" title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={guardarEdicion}
                  disabled={savingEdit}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar
                </button>
              )}
              <button onClick={() => abrirFicha(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                {selected.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{selected.nombre} {selected.apellidos}</p>
                <p className="text-xs text-muted-foreground">{nombreDe(catalogos, "fuente", selected.fuente)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contacto</p>
              {editando ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Teléfono</label>
                    <input
                      type="tel"
                      value={editTel}
                      onChange={(e) => setEditTel(e.target.value)}
                      placeholder="Sin teléfono"
                      className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Sin email"
                      className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {selected.telefono ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Teléfono</span>
                      <a href={`tel:${selected.telefono}`} className="text-foreground hover:underline">{selected.telefono}</a>
                    </div>
                  ) : null}
                  {selected.email ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Email</span>
                      <a href={`mailto:${selected.email}`} className="text-foreground hover:underline truncate">{selected.email}</a>
                    </div>
                  ) : null}
                  {!selected.telefono && !selected.email && (
                    <p className="text-muted-foreground/60 italic">Sin datos de contacto</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cambiar estado</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ESTADOS.map(({ valor: e, nombre, color }) => (
                  <button
                    key={e}
                    onClick={() => cambiarEstado(selected.id, e)}
                    disabled={updatingId === selected.id}
                    className={cn(
                      "text-xs px-2 py-1.5 rounded border font-medium transition-all",
                      selected.estado === e
                        ? claseColor(color)
                        : "border-border text-muted-foreground hover:border-muted-foreground/40",
                    )}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Quién lo lleva ── */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agente</p>

              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2",
                  selected.agente ? "border-border bg-muted/40" : "bg-amber-500/10 border-amber-500/30",
                )}
              >
                <UserCircle
                  className={cn(
                    "h-4 w-4 shrink-0",
                    selected.agente ? "text-muted-foreground" : "text-amber-600 dark:text-amber-300",
                  )}
                />
                <div className="min-w-0 flex flex-1 flex-col">
                  <span
                    className={cn(
                      "text-xs font-medium truncate",
                      selected.agente ? "text-foreground" : "text-amber-600 dark:text-amber-300",
                    )}
                  >
                    {nombrePersona(selected.agente)}
                  </span>
                  {/* Por qué está como está: "esperando asignación" o "nadie
                      disponible" lo escribe el reparto, y leerlo evita el clásico
                      "esto está roto" cuando lo que pasa es que el modo es manual.
                      Desde ahora también dice quién se lo quitó y cuándo. */}
                  {!selected.agente && selected.asignacion_motivo && (
                    <span className="text-[11px] text-muted-foreground truncate">{selected.asignacion_motivo}</span>
                  )}
                </div>

                {/* Quitarlo va AQUÍ, pegado al nombre de quien lo lleva, y no
                    como una casilla más de la rejilla de abajo: la rejilla
                    contesta "¿a quién?" y esto contesta "a nadie", que no es un
                    agente más. Metido entre los nombres, sería el botón de
                    vaciar la cuenta de alguien a un pixel del de asignársela.
                    Sólo sale si hay agente que quitar —sin él no hay nada que
                    hacer—, y sólo para el administrador, aunque quien lo impide
                    de verdad es la acción de servidor. */}
                {isAdmin && selected.agente_id && (
                  <button
                    onClick={quitarAgente}
                    disabled={quitando || asignando !== null}
                    title="Dejar el lead sin agente"
                    className="flex items-center gap-1 shrink-0 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-all disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {quitando ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : (
                      <UserMinus className="h-3 w-3 shrink-0" />
                    )}
                    Quitar
                  </button>
                )}
              </div>

              {/* Repartir es cosa del administrador: la acción de servidor
                  rechaza a los demás, así que enseñarles los botones sería
                  ofrecerles algo que va a fallar. */}
              {isAdmin && (
                agentes === null ? (
                  <p className="text-xs text-muted-foreground/60 italic">Cargando el equipo...</p>
                ) : agentes.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 italic">No hay agentes a los que repartir</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {agentes.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => asignarA(a.id, a.nombre)}
                        disabled={asignando !== null || quitando || selected.agente_id === a.id}
                        className={cn(
                          "flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border font-medium transition-all disabled:opacity-50 disabled:pointer-events-none",
                          selected.agente_id === a.id
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30"
                            : "border-border text-muted-foreground hover:border-muted-foreground/40",
                        )}
                      >
                        {asignando === a.id ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                        ) : selected.agente_id === a.id ? (
                          <Check className="h-3 w-3 shrink-0" />
                        ) : (
                          <UserPlus className="h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">{a.nombre}</span>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* ATENDER.
                Faltaba, y era el agujero por el que se caía todo el trabajo del
                agente sobre un lead de Instagram o de la web. El componente
                acepta `leadId` desde la 021 y la RPC `atender()` lo mueve todo
                —nota, recordatorio en el calendario y el embudo—, pero sólo lo
                montaban la ficha de captación y la de prospecto. Aquí no.
                Resultado: los 137 leads de demanda tenían `atendido_en` a nulo y
                NO había forma de escribirlo desde ninguna pantalla; en la
                portada del agente se quedaban para siempre como "sin atender",
                y el salto Nuevo -> Contactado de la 030 no se podía disparar.

                Va ENCIMA de las notas y no debajo: apuntar lo que acaba de pasar
                en la llamada es la acción del día; las notas de abajo son lo que
                ya estaba escrito. */}
            <Atendido
              leadId={selected.id}
              catalogos={catalogos}
              yaAtendido={
                selected.atendido_en
                  ? { en: selected.atendido_en, por: selected.atendedor ? nombrePersona(selected.atendedor) : null }
                  : null
              }
              // Atender mueve el estado del lead (la 030), así que no vale con
              // refrescar el panel: la pastilla de la fila y los contadores de
              // arriba se quedarían con lo de antes hasta recargar a mano.
              onHecho={() => { if (userId) void fetchLeads(userId, isAdmin, pagina) }}
            />

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notas</p>
              {editando ? (
                <textarea
                  value={editNotas}
                  onChange={(e) => setEditNotas(e.target.value)}
                  rows={4}
                  placeholder="Añade notas sobre este lead..."
                  className="w-full px-2.5 py-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              ) : selected.notas ? (
                <p className="text-xs text-foreground leading-relaxed bg-muted/50 rounded-md p-3">{selected.notas}</p>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic">Sin notas</p>
              )}
            </div>

            <div className="space-y-1.5 pt-3 border-t border-border text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Creado</span>
                <span className="text-foreground">
                  {new Date(selected.fecha_creacion).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              {/* Quien lo trajo, que ya no es quien lo trabaja: `captado_por` no
                  se pisa al traspasar, y por eso son dos líneas distintas. */}
              {isAdmin && selected.captador && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Captado por</span>
                  <span className="text-foreground">{nombrePersona(selected.captador)}</span>
                </div>
              )}
              {selected.captacion_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Captación</span>
                  <span className="text-foreground font-mono">#{selected.captacion_id}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nuevo lead ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-in">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-xl shadow-2xl modal-card-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold">Nuevo lead</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form ref={formRef} onSubmit={handleCrearLead} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nombre <span className="text-red-400">*</span></label>
                  <input
                    name="nombre"
                    required
                    placeholder="Ej: Josep"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Apellidos</label>
                  <input
                    name="apellidos"
                    placeholder="Ej: García"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Teléfono</label>
                <input
                  name="telefono"
                  type="tel"
                  placeholder="Ej: 612345678"
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Origen</label>
                <select
                  name="fuente"
                  // La primera del catálogo, no un "Manual" fijo: ese valor no
                  // existe en `catalogos`, así que al guardar el lead el trigger
                  // de la migración 012 lo daba de alta como fuente inactiva y
                  // ensuciaba la lista con algo que nadie había creado.
                  defaultValue={FUENTES[0]?.valor ?? ""}
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {FUENTES.map((f) => <option key={f.valor} value={f.valor}>{f.nombre}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notas</label>
                <textarea
                  name="notas"
                  rows={3}
                  placeholder="Contexto del contacto, observaciones..."
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {saveError && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-2">{saveError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-9 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Crear lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
