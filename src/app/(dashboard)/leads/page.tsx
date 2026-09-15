import { exigirModulo } from "@/lib/auth/acceso"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import LeadsClient from "./leads-client"

export const metadata = { title: "Leads — mkgenia" }

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ fuente?: string }>
}) {
  await exigirModulo("leads")

  // Los estados y las fuentes se leen del catálogo, no de una lista escrita en
  // el código. Es la única forma de que un estado creado desde
  // /configuracion/catalogos aparezca aquí sin desplegar nada, que es para lo
  // que existe la tabla `catalogos`.
  const catalogos = await getCatalogosActivos()

  /**
   * De dónde vienen: `/leads?fuente=Instagram`.
   *
   * Lo estrena el resumen de orígenes de la portada del agente, para que un
   * número se pueda pulsar y lleve a la lista de esos leads en concreto. Un
   * contador que no lleva a ninguna parte se deja de mirar a la semana.
   *
   * Se lee AQUÍ, en el servidor, y baja como prop. Leerlo en el navegador con
   * `window.location` daría un primer render sin filtro y otro con él —el
   * clásico desajuste de hidratación—, y `useSearchParams` obligaría a envolver
   * media pantalla en un Suspense para nada.
   *
   * Se valida contra el catálogo: el valor viene de la URL, que la escribe
   * cualquiera. Una fuente que no existe se ignora y se enseña la lista entera,
   * que es menos malo que una pantalla vacía sin explicación.
   */
  const { fuente } = await searchParams
  const fuenteInicial =
    fuente && catalogos.some((c) => c.tipo === "fuente" && c.valor === fuente) ? fuente : ""

  return <LeadsClient catalogos={catalogos} fuenteInicial={fuenteInicial} />
}
