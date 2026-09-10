import Link from "next/link"
import { Lock, ArrowRight } from "lucide-react"
import { MODULOS } from "@/types/database"

export const metadata = { title: "Sin acceso — mkgenia" }

export default async function SinAccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>
}) {
  const { m } = await searchParams
  const modulo = MODULOS.find((x) => x.key === m)
  const nombre = m === "admin" ? "Esta sección" : modulo ? `"${modulo.label}"` : "Esta sección"

  return (
    <div className="p-8">
      <div className="max-w-lg">
        <div className="flex items-center gap-2.5 mb-4">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sin acceso
          </span>
        </div>

        <h1 className="text-2xl font-semibold text-foreground">
          {nombre} no está en tu cuenta
        </h1>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          {m === "admin"
            ? "Es una sección de administración: sólo la ve quien lleva la configuración del CRM."
            : "Un administrador decide qué secciones ve cada miembro del equipo. Si necesitas ésta para tu trabajo, pídesela y la activa en un clic desde Equipo."}
        </p>

        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-violet-500 hover:text-violet-400 transition-colors"
        >
          Volver a Mi día
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
