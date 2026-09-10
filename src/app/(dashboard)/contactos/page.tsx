import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Contactos — mkgenia" }

export default async function Page() {
  await exigirModulo("leads")

  return (
    <EnDesarrollo
      titulo="Contactos"
      descripcion={"La ficha única de cada persona: sus datos, por dónde entró, todo lo que ha preguntado y en qué punto está. Hoy esa información vive repartida entre leads, captaciones y demandas."}
      mientrasTanto={{
        texto: "Los leads actuales siguen donde estaban, con sus 900 registros y su pipeline.",
        href: "/leads",
        enlace: "Ir a Leads",
      }}
    />
  )
}
