import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getZonasStats, getValoraciones, getFactoresMercado } from "@/lib/actions/valorador"
import { ValoradorShell } from "@/components/valorador/valorador-shell"

export const metadata = { title: "Valorador — mkgenia" }

export default async function ValoradorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [statsVenta, statsAlquiler, valoraciones, factores] = await Promise.all([
    getZonasStats("venta"),
    getZonasStats("alquiler"),
    getValoraciones(),
    getFactoresMercado("venta"),
  ])

  return (
    <div className="h-full">
      <ValoradorShell
        statsVenta={statsVenta}
        statsAlquiler={statsAlquiler}
        valoracionesIniciales={valoraciones}
        factores={factores}
      />
    </div>
  )
}
