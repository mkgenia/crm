import { exigirModulo } from "@/lib/auth/acceso"
import { getCatalogos, getUsoCatalogos } from "@/lib/actions/catalogos"
import { CatalogosClient } from "./catalogos-client"

export const metadata = { title: "Catálogos — mkgenia" }

/**
 * Panel de catálogos. Sólo administrador.
 *
 * La puerta va aquí y no en el layout: el de (dashboard) se reutiliza entre
 * rutas hermanas y no se vuelve a ejecutar al navegar, así que comprobarlo allí
 * dejaría entrar a quien llegue desde otra pantalla.
 */
export default async function Page() {
  await exigirModulo("catalogos")

  // El uso se pide a la vez que los valores porque sin el recuento la pantalla
  // no se puede usar: archivar sin saber cuántas filas lo tienen es a ciegas.
  const [datos, uso] = await Promise.all([getCatalogos(), getUsoCatalogos()])

  return <CatalogosClient catalogos={datos.catalogos} uso={uso} error={datos.error} />
}
