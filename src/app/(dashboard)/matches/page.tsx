import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Matches — mkgenia" }

export default async function Page() {
  await exigirModulo("matches")

  return (
    <EnDesarrollo
      titulo="Matches"
      descripcion={"Cruzar automáticamente lo que busca cada demanda con lo que hay en la cartera, y avisar cuando entre una propiedad que encaje con alguien que ya preguntó."}
      mientrasTanto={{
        texto: "Las demandas que van entrando ya se pueden consultar y cualificar.",
        href: "/demandas",
        enlace: "Ir a Demandas",
      }}
    />
  )
}
