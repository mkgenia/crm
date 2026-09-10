import { getCaptaciones, getCaptacionesEliminadas, getCaptacionesEliminadasPorAgente, getAgentes } from "@/lib/actions/captaciones"
import { getAutoContactoConfig, getEstadoCola } from "@/lib/actions/captaciones-config"
import { CaptacionesList } from "@/components/captaciones/captaciones-list"
import { PapeleraList } from "@/components/captaciones/papelera-list"
import { CaptacionesConfig } from "@/components/captaciones/captaciones-config"
import { exigirModulo } from "@/lib/auth/acceso"

export const metadata = { title: "Captaciones — mkgenia" }

export default async function CaptacionesPage() {
  const { userId, isAdmin } = await exigirModulo("captaciones")

  const [captaciones, eliminadas, config, agentes, cola] = await Promise.all([
    isAdmin
      ? getCaptaciones(undefined, undefined, undefined, true)
      : getCaptaciones(undefined, undefined, userId),
    isAdmin ? getCaptacionesEliminadas() : getCaptacionesEliminadasPorAgente(userId),
    isAdmin ? getAutoContactoConfig() : null,
    isAdmin ? getAgentes() : [],
    isAdmin ? getEstadoCola() : { enCola: 0, enviadasHoy: 0 },
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
          <CaptacionesConfig
            enabled={config.enabled}
            zonas={config.zonas}
            limiteDiario={config.limiteDiario}
            ritmo={config.ritmo}
            uso={config.uso}
            cola={cola}
          />
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
