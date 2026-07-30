import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getZonasStats, getValoraciones } from "@/lib/actions/valorador"
import { ValoradorShell } from "@/components/valorador/valorador-shell"

export const metadata = { title: "Valorador — mkgenia" }

export default async function ValoradorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [statsVenta, statsAlquiler, valoraciones] = await Promise.all([
    getZonasStats("venta"),
    getZonasStats("alquiler"),
    getValoraciones(),
  ])

  return (
    <div className="h-full">
      <ValoradorShell
        statsVenta={statsVenta}
        statsAlquiler={statsAlquiler}
        valoracionesIniciales={valoraciones}
      />
    </div>
  )
}
