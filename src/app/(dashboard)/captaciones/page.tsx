import { getCaptaciones, getCaptacionesEliminadas, getCaptacionesEliminadasPorAgente, getAgentes } from "@/lib/actions/captaciones"
import { getAutoContactoConfig } from "@/lib/actions/captaciones-config"
import { CaptacionesList } from "@/components/captaciones/captaciones-list"
import { PapeleraList } from "@/components/captaciones/papelera-list"
import { CaptacionesConfig } from "@/components/captaciones/captaciones-config"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export const metadata = { title: "Captaciones — mkgenia" }

export default async function CaptacionesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", user.id)
    .single()

  const isAdmin = perfil?.rol === "Admin"

  const [captaciones, eliminadas, config, agentes] = await Promise.all([
    isAdmin
      ? getCaptaciones(undefined, undefined, undefined, true)
      : getCaptaciones(undefined, undefined, user.id),
    isAdmin ? getCaptacionesEliminadas() : getCaptacionesEliminadasPorAgente(user.id),
    isAdmin ? getAutoContactoConfig() : null,
    isAdmin ? getAgentes() : [],
  ])

  const total = captaciones.length
  const totalSinAgente = isAdmin ? captaciones.filter((c) => !c.agente_id).length : 0
  const totalAgendadas = captaciones.filter((c) => !!c.agente_id).length

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {isAdmin ? "Captaciones" : "Mis captaciones"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? `${total} propiedades · ${totalSinAgente} sin asignar`
              : `${total} captaciones asignadas`}
          </p>
        </div>
        {isAdmin && config && (
          <CaptacionesConfig enabled={config.enabled} zonas={config.zonas} />
        )}
      </div>

      <CaptacionesList
        initialData={captaciones as any}
        eliminadas={eliminadas as any}
        total={total}
        totalSinAgente={totalSinAgente}
        totalAgendadas={totalAgendadas}
        isAdmin={isAdmin}
        agentes={agentes}
      />
    </div>
  )
}
