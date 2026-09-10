import { exigirModulo } from "@/lib/auth/acceso"
import { getZonasStats, getValoraciones, getFactoresMercado } from "@/lib/actions/valorador"
import { ValoradorShell } from "@/components/valorador/valorador-shell"

export const metadata = { title: "Valorador — mkgenia" }

export default async function ValoradorPage() {
  await exigirModulo("valorador")

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
