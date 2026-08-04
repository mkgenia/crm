import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getValoracion } from "@/lib/actions/valorador"
import { InformeValoracion } from "@/components/valorador/informe-valoracion"

export const metadata = { title: "Informe de valoración — mkgenia" }

export default async function InformePage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { id } = await params
  const valoracion = await getValoracion(Number(id))
  if (!valoracion) notFound()

  return <InformeValoracion v={valoracion} />
}
