import { exigirAdmin } from "@/lib/auth/acceso"
import { EnDesarrollo } from "@/components/shared/en-desarrollo"

export const metadata = { title: "Workflows — mkgenia" }

export default async function Page() {
  await exigirAdmin()

  return (
    <EnDesarrollo
      titulo="Workflows"
      descripcion={"Estado de los automatismos de n8n desde el propio CRM: qué corre, cuándo pasó por última vez, qué falló y cuánto lleva gastado el captador este mes."}
      mientrasTanto={{
        texto: "El gasto de Apify y el ritmo de envío ya se controlan desde la configuración del captador.",
        href: "/captaciones",
        enlace: "Ir a Scraper",
      }}
    />
  )
}
