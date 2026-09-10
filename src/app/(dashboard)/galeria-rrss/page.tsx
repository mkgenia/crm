import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Galería RRSS — mkgenia" }

export default async function Page() {
  await exigirModulo("galeria_rrss")

  return (
    <EnDesarrollo
      titulo="Galería RRSS"
      descripcion={"Generar las piezas para redes a partir de las propiedades de la cartera, con su ficha y sus fotos, y llevar el rastro de qué se publicó y qué leads trajo cada publicación."}
    />
  )
}
