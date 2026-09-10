import { exigirModulo } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Prospectos — mkgenia" }

export default async function Page() {
  await exigirModulo("prospectos")

  return (
    <EnDesarrollo
      titulo="Prospectos"
      descripcion={"Los propietarios captados, ya cualificados y trabajados por un agente: el paso siguiente a lo que el scraper trae en bruto."}
      mientrasTanto={{
        texto: "Lo que el captador trae de Idealista está en el Scraper, con su estado de WhatsApp y su ficha.",
        href: "/captaciones",
        enlace: "Ir a Scraper",
      }}
    />
  )
}
