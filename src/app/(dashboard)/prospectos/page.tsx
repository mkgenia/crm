import { exigirModulo } from "@/lib/auth/acceso"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { getAgentes } from "@/lib/actions/captaciones"
import ProspectosClient from "@/components/prospectos/prospectos-client"
import type { PersonaLinea } from "@/components/shared/linea-tiempo"

export const metadata = { title: "Prospectos — mkgenia" }

export default async function ProspectosPage() {
  // La puerta va en la propia página y no en el layout: el de (dashboard) se
  // reutiliza entre rutas hermanas y no se vuelve a ejecutar al navegar, así que
  // una comprobación allí dejaría pasar a quien llegue desde otra pantalla.
  const sesion = await exigirModulo("prospectos")

  // Quién soy y qué puedo se resuelve AQUÍ, en el servidor, y baja como prop.
  // Preguntárselo al navegador sería aceptar la respuesta de quien pregunta.
  const [catalogos, equipo] = await Promise.all([getCatalogosActivos(), getAgentes()])

  // La línea de tiempo y las columnas de "lo captó" y "lo lleva" sólo necesitan
  // el nombre de cada compañero: se deriva una vez aquí en vez de volver a pedir
  // los perfiles desde el navegador.
  const personas: PersonaLinea[] = (
    equipo as Array<{ id: string; nombre: string | null; apellidos: string | null }>
  ).map((a) => ({
    id: a.id,
    nombre: `${a.nombre ?? ""} ${a.apellidos ?? ""}`.trim() || "—",
  }))

  return (
    <ProspectosClient
      catalogos={catalogos}
      personas={personas}
      yoId={sesion.userId}
      isAdmin={sesion.isAdmin}
    />
  )
}
