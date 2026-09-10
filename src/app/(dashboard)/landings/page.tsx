import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Landings — mkgenia" }

export default async function Page() {
  await exigirModulo("landings")

  return (
    <EnDesarrollo
      titulo="Landings"
      descripcion={"Páginas de captación por campaña o por promoción, con su formulario propio, para que el lead entre etiquetado con su origen en vez de mezclarse con el resto del formulario web."}
    />
  )
}
