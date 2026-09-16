import { exigirModulo } from "@/lib/auth/acceso"
import { getCatalogos, getCatalogosActivos } from "@/lib/actions/catalogos"
import LeadsClient from "./leads-client"

export const metadata = { title: "Leads — mkgenia" }

/**
 * Cómo se lee en pantalla el corte de fecha que llega en `?desde=`.
 *
 * Las tres frases son las mismas que ya dice el selector de periodo de la
 * portada ("Entrados hoy", "En los últimos 7 días"…), porque el agente viene de
 * pulsar justo ese botón: si allí ponía "7 días" y aquí pusiera "de la última
 * semana", parecería otro filtro.
 */
const ETIQUETA_PERIODO: Record<string, string> = {
  hoy: "Entrados hoy",
  semana: "Entrados en los últimos 7 días",
  mes: "Entrados en los últimos 30 días",
}

/**
 * Para cuando llega un corte sin su palabra: se escribe la fecha.
 *
 * Zona y formato fijos porque este texto se calcula en el SERVIDOR y baja ya
 * escrito: el navegador lo pinta tal cual, así que no hay dos versiones que
 * puedan no coincidir al hidratar.
 */
const FECHA_CORTA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "2-digit", timeZone: "Europe/Madrid",
})

/** Una uuid y nada más: es lo que `leads.id` puede ser. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ fuente?: string; desde?: string; periodo?: string; lead?: string }>
}) {
  await exigirModulo("leads")

  // Los estados y las fuentes se leen del catálogo, no de una lista escrita en
  // el código. Es la única forma de que un estado creado desde
  // /configuracion/catalogos aparezca aquí sin desplegar nada, que es para lo
  // que existe la tabla `catalogos`.
  const catalogos = await getCatalogosActivos()

  /**
   * LO QUE ESTA PANTALLA ACEPTA POR LA URL, y de dónde viene.
   *
   * Lo escriben las tarjetas y las filas de la portada del agente, para que un
   * número se pueda pulsar y lleve a LO QUE ENSEÑA. Un contador que no lleva a
   * ninguna parte se deja de mirar a la semana, y una fila que lleva a una lista
   * de 1.090 nombres obliga a buscar a mano el que acabas de leer.
   *
   *   · `fuente`  una o VARIAS fuentes separadas por comas. Varias porque cada
   *               tarjeta agrupa una familia —Instagram y Facebook son la misma
   *               pregunta— y el número de la tarjeta las cuenta todas.
   *   · `desde`   el instante en que empieza el periodo que el agente tenía
   *               puesto, ya calculado en la portada con el MISMO corte con el
   *               que se contó el número. Es lo que evita que la tarjeta diga 3
   *               y aquí salgan 121.
   *   · `periodo` sólo para poder escribir la chapa con palabras.
   *   · `lead`    una ficha concreta, la de la fila que se ha pulsado.
   *
   * Todo se lee AQUÍ, en el servidor, y baja como prop. Leerlo en el navegador
   * con `window.location` daría un primer render sin filtro y otro con él —el
   * clásico desajuste de hidratación—, y `useSearchParams` obligaría a envolver
   * media pantalla en un Suspense para nada.
   *
   * Y todo se valida, porque la URL la escribe cualquiera: lo que no cuadra se
   * ignora y se enseña la lista entera, que es menos malo que una pantalla vacía
   * sin explicación o que un 400 de PostgREST disfrazado de "no tienes leads".
   */
  const { fuente, desde, periodo, lead } = await searchParams

  // Lo que pide la URL, sin vacíos y sin repetidas: `.in()` con la misma fuente
  // dos veces no cambia el resultado pero sí la chapa, que la pintaría dos
  // veces. La comprobación contra el catálogo va justo debajo.
  const pedidas = (fuente ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter((f, i, todas) => f !== "" && todas.indexOf(f) === i)

  /**
   * Y CADA UNA CONTRA EL CATÁLOGO ENTERO, ARCHIVADAS INCLUIDAS.
   *
   * ARREGLADO EN REVISIÓN: se comprobaban contra el catálogo ACTIVO, y eso
   * rompía en silencio justo lo que el enlace de la tarjeta viene a arreglar.
   * Una fuente nueva —'Facebook', 'Landing'— no la escribe nadie a mano: la da
   * de alta sola el trigger `leads_fuente_cat` de la 012 (012:216) en cuanto
   * entra el primer lead con ella, y la da de alta DESACTIVADA, esperando a que
   * el administrador le ponga nombre y color. La tarjeta de la portada sí la
   * cuenta, porque cuenta contra la tabla (`.in('fuente', familia)`) y no contra
   * el catálogo. O sea que ese día la tarjeta diría 5, la lista enseñaría 3 y
   * nada fallaría: la contradicción exacta que este encargo quita de en medio.
   *
   * La comprobación sigue en pie —es lo que impide que llegue hasta `.in()` un
   * texto escrito a mano en la barra del navegador—, sólo que ahora vale también
   * una archivada. En pantalla se lee igual: `nombreDe` cae al propio valor
   * cuando no encuentra la fila en el catálogo activo.
   *
   * El catálogo completo sólo se pide si la URL trae fuentes, que es una de cada
   * tantas veces: sin ellas esto no gasta ni una consulta.
   */
  const todasLasFuentes = pedidas.length > 0 ? (await getCatalogos()).catalogos : []
  const fuentesIniciales = pedidas.filter((f) =>
    todasLasFuentes.some((c) => c.tipo === "fuente" && c.valor === f))

  // Se normaliza a ISO en vez de pasar el texto tal cual: así lo que viaja a la
  // consulta es siempre una fecha que Postgres entiende. Una ilegible se queda
  // fuera —NaN no es mayor ni menor que nada— y la lista sale entera.
  const ms = desde ? new Date(desde).getTime() : NaN
  const desdeInicial = Number.isNaN(ms) ? "" : new Date(ms).toISOString()

  // ARREGLADO EN REVISIÓN: con `Object.hasOwn` y no leyendo la clave a pelo.
  // `ETIQUETA_PERIODO["toString"]` no devuelve undefined: devuelve la función
  // que el objeto hereda del prototipo, y `?periodo=toString` la colaba hasta la
  // chapa como si fuera texto. React no pinta una función como hijo —se queda el
  // hueco en blanco y suelta un aviso en consola—, así que la chapa aparecía muda
  // en vez de decir desde cuándo se está filtrando.
  const palabraPeriodo =
    periodo && Object.hasOwn(ETIQUETA_PERIODO, periodo) ? ETIQUETA_PERIODO[periodo] : ""

  const etiquetaDesde = !desdeInicial
    ? ""
    : palabraPeriodo || `Entrados desde el ${FECHA_CORTA.format(ms)}`

  // Un id que no tiene forma de uuid ni se pregunta: PostgREST contestaría 400
  // y la pantalla diría "no se han podido cargar los leads", que es un fallo
  // donde sólo hay una URL mal escrita.
  const leadInicial = lead && UUID.test(lead) ? lead : ""

  return (
    <LeadsClient
      catalogos={catalogos}
      fuentesIniciales={fuentesIniciales}
      desdeInicial={desdeInicial}
      etiquetaDesde={etiquetaDesde}
      leadInicial={leadInicial}
    />
  )
}
