import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Galería QR — mkgenia" }

export default async function Page() {
  await exigirModulo("galeria_qr")

  return (
    <EnDesarrollo
      titulo="Galería QR"
      descripcion={"Códigos QR para carteles, escaparate y cartelería de obra, cada uno apuntando a su propiedad y contando cuántos escaneos y cuántos contactos genera."}
    />
  )
}
