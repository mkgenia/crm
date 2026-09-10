import { exigirAdmin } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Agentes IA — mkgenia" }

export default async function Page() {
  await exigirAdmin()

  return (
    <EnDesarrollo
      titulo="Agentes IA"
      descripcion={"El panel de los agentes que ya trabajan: el que redacta los mensajes de captación, el que clasifica las respuestas y el bot que atiende WhatsApp. Aquí se verán sus conversaciones, su coste y sus reglas."}
    />
  )
}
