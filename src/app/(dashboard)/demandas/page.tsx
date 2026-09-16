import { exigirModulo } from "@/lib/auth/acceso"
import DemandasClient from "./demandas-client"

export const metadata = { title: "Demandas — mkgenia" }

/**
 * Cómo se lee en pantalla el corte de fecha que llega en `?desde=`.
 *
 * Son las mismas tres frases que ya dice el selector de periodo de la portada
 * ("Entrados hoy", "En los últimos 7 días"…) y las mismas que pinta /leads,
 * porque se llega aquí de pulsar justo ese botón: si allí ponía "7 días" y aquí
 * pusiera "de la última semana", parecería otro filtro.
 *
 * "Entradas" y no "entrados" porque lo que se está filtrando son DEMANDAS.
 */
const ETIQUETA_PERIODO: Record<string, string> = {
  hoy: "Entradas hoy",
  semana: "Entradas en los últimos 7 días",
  mes: "Entradas en los últimos 30 días",
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

export default async function DemandasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; periodo?: string }>
}) {
  await exigirModulo("demandas")

  /**
   * LO QUE ESTA PANTALLA ACEPTA POR LA URL, y de dónde viene.
   *
   * Lo escribe la tarjeta "Demandas" de las dos portadas —la del administrador y
   * la del agente—, para que un número se pueda pulsar y lleve a LO QUE ENSEÑA.
   * Hasta hoy la tarjeta decía 47 con "7 días" puesto y aterrizaba en las 1.825
   * de siempre.
   *
   *   · `desde`   el instante en que empieza el periodo que había puesto, ya
   *               calculado en la portada con el MISMO reloj y la MISMA función
   *               con los que se contó el número.
   *   · `periodo` sólo para poder escribir la chapa con palabras.
   *
   * Se lee AQUÍ, en el servidor, y baja como prop. Leerlo en el navegador con
   * `window.location` daría un primer render sin filtro y otro con él —el
   * clásico desajuste de hidratación—, y `useSearchParams` obligaría a envolver
   * media pantalla en un Suspense para nada.
   *
   * Y se valida, porque la URL la escribe cualquiera: lo que no cuadra se ignora
   * y se enseña la lista entera, que es menos malo que una pantalla vacía sin
   * explicación o que un 400 de PostgREST disfrazado de "no hay demandas".
   */
  const { desde, periodo } = await searchParams

  // Se normaliza a ISO en vez de pasar el texto tal cual: así lo que viaja a la
  // consulta es siempre una fecha que Postgres entiende. Una ilegible da NaN y
  // se queda fuera —NaN no es mayor ni menor que nada—, y la lista sale entera.
  const ms = desde ? new Date(desde).getTime() : NaN
  const desdeInicial = Number.isNaN(ms) ? "" : new Date(ms).toISOString()

  // Con `Object.hasOwn` y no leyendo la clave a pelo, por lo mismo que en
  // /leads: `ETIQUETA_PERIODO["toString"]` no devuelve undefined sino la función
  // heredada del prototipo, y `?periodo=toString` la colaría hasta la chapa.
  // React no pinta una función como hijo —se queda el hueco en blanco—, así que
  // la chapa aparecería muda en vez de decir desde cuándo se está filtrando.
  const palabraPeriodo =
    periodo && Object.hasOwn(ETIQUETA_PERIODO, periodo) ? ETIQUETA_PERIODO[periodo] : ""

  const etiquetaDesde = !desdeInicial
    ? ""
    : palabraPeriodo || `Entradas desde el ${FECHA_CORTA.format(ms)}`

  return (
    <DemandasClient
      /**
       * ARREGLADO EN REVISIÓN: la `key` ES el corte.
       *
       * El corte vive dentro del cliente como estado (`useState(desdeInicial)`)
       * para poder soltarlo con la chapa, y un `useState` sólo lee su valor
       * inicial LA PRIMERA VEZ. Sin esta línea, ir de /demandas?desde=… a
       * /demandas pulsando "Demandas" en la barra lateral no quitaba el filtro:
       * es la MISMA ruta, así que Next no desmonta esta pantalla —sólo le cambia
       * las props— y el estado viejo sobrevivía. La barra del navegador decía
       * "todas" y la pantalla seguía enseñando la chapa y trece propiedades.
       *
       * Con la `key`, cambiar el corte por la URL monta una pantalla nueva y el
       * estado arranca en lo que diga la URL. Soltar la chapa con su X NO pasa
       * por aquí —la URL no cambia, la `key` tampoco— así que ese clic sigue
       * siendo instantáneo y no pierde ni la búsqueda ni la página.
       */
      key={desdeInicial || "sin-corte"}
      desdeInicial={desdeInicial}
      etiquetaDesde={etiquetaDesde}
    />
  )
}
