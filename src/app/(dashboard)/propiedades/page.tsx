import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Propiedades — mkgenia" }

export default async function Page() {
  await exigirModulo("propiedades")

  return (
    <EnDesarrollo
      titulo="Propiedades"
      descripcion={"La cartera en el CRM: lo que hoy llega del XML de Inmovilla, con su ficha, sus fotos y su estado, para poder cruzarla con las demandas sin salir de aquí."}
    />
  )
}
