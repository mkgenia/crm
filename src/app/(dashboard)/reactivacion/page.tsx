import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Reactivación — mkgenia" }

export default async function Page() {
  await exigirModulo("reactivacion")

  return (
    <EnDesarrollo
      titulo="Reactivación"
      descripcion={"Volver a escribir a propietarios que ya recibieron un primer mensaje y no contestaron. El captador tiene hoy 272 con el anuncio de más de 45 días en ese estado: siguen sin vender y el mensaje de \"sigue en venta\" ya está escrito."}
    />
  )
}
