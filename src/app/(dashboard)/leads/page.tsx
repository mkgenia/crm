import { exigirModulo } from "@/lib/auth/acceso"
import LeadsClient from "./leads-client"

export const metadata = { title: "Leads — mkgenia" }

export default async function LeadsPage() {
  await exigirModulo("leads")
  return <LeadsClient />
}
