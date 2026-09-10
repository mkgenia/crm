import { exigirModulo } from "@/lib/auth/acceso"
import DemandasClient from "./demandas-client"

export const metadata = { title: "Demandas — mkgenia" }

export default async function DemandasPage() {
  await exigirModulo("demandas")
  return <DemandasClient />
}
