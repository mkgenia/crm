import { exigirModulo } from "@/lib/auth/acceso"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { getAgentes } from "@/lib/actions/captaciones"
import ContactosClient from "@/components/contactos/contactos-client"
import type { PersonaLinea } from "@/components/shared/linea-tiempo"

export const metadata = { title: "Contactos — mkgenia" }

/**
 * Contactos: las personas de la agencia.
 *
 * Aquí había un cartel de "En desarrollo" con un número escrito a mano ("sus
 * 900 registros"). El dato existía desde el principio —`leads.contacto_desde`,
 * que marca `promocionar_captacion()` al pasar una captación a prospecto—, pero
 * sin pantalla que lo enseñara la rueda parecía rota: se captaba, se creaba el
 * prospecto, y la persona no aparecía por ninguna parte.
 */
export default async function ContactosPage() {
  // La puerta va en la propia página y no en el layout: el de (dashboard) se
  // reutiliza entre rutas hermanas y no se vuelve a ejecutar al navegar, así que
  // una comprobación allí dejaría pasar a quien llegue desde otra pantalla.
  // Mismo módulo que /leads: un contacto es un lead que ya ha dado el paso.
  const sesion = await exigirModulo("leads")

  const [catalogos, equipo] = await Promise.all([getCatalogosActivos(), getAgentes()])

  const personas: PersonaLinea[] = (
    equipo as Array<{ id: string; nombre: string | null; apellidos: string | null }>
  ).map((a) => ({
    id: a.id,
    nombre: `${a.nombre ?? ""} ${a.apellidos ?? ""}`.trim() || "—",
  }))

  return <ContactosClient catalogos={catalogos} personas={personas} isAdmin={sesion.isAdmin} />
}
