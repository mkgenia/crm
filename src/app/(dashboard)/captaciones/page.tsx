import { getCaptaciones, getCaptacionesEliminadas, getCaptacionesEliminadasPorAgente, getAgentes, getTotalesCaptaciones } from "@/lib/actions/captaciones"
import { getAutoContactoConfig, getEstadoCola } from "@/lib/actions/captaciones-config"
import { CaptacionesList } from "@/components/captaciones/captaciones-list"
import { PapeleraList } from "@/components/captaciones/papelera-list"
import { CaptacionesConfig } from "@/components/captaciones/captaciones-config"
import { exigirModulo } from "@/lib/auth/acceso"
import { getEstadoAsignacion } from "@/lib/actions/asignacion"

export const metadata = { title: "Captaciones — mkgenia" }

export default async function CaptacionesPage() {
  const { userId, isAdmin } = await exigirModulo("captaciones")

  const [primeraPagina, eliminadas, config, agentes, cola, reparto, totales] = await Promise.all([
    // Sólo la primera página: el resto las pide la lista al cambiar de página o
    // de filtro. getCaptaciones resuelve por su cuenta quién eres, así que ya no
    // hay que pasarle el rol ni el id del agente.
    getCaptaciones(),
    isAdmin ? getCaptacionesEliminadas() : getCaptacionesEliminadasPorAgente(userId),
    isAdmin ? getAutoContactoConfig() : null,
    isAdmin ? getAgentes() : [],
    isAdmin ? getEstadoCola() : { enCola: 0, enviadasHoy: 0 },
    // Sólo el administrador ve el panel de reparto, así que sólo para él se pide.
    isAdmin ? getEstadoAsignacion() : null,
    getTotalesCaptaciones(isAdmin ? undefined : userId),
  ])

  // De la base de datos y no de la lista: la lista sólo trae la página que se
  // ve, y contar sobre ella daría 50 pase lo que pase.
  const total = totales.total
  const totalSinAgente = isAdmin ? totales.sinAgente : 0
  // "Agendadas" en los filtros de la lista quiere decir "con agente asignado",
  // así que es el total menos las que no tienen. El contador `agendadas` de
  // getTotalesCaptaciones cuenta otra cosa —pendiente Y con agente—, que es
  // justo el filtro "Pendientes": ponerlo en el chip de Agendadas hacía que el
  // número cambiara al pulsarlo.
  const totalAgendadas = total - totalSinAgente
  const totalPendientes = totales.agendadas

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
        {isAdmin && config && reparto && (
          <CaptacionesConfig
            enabled={config.enabled}
            zonas={config.zonas}
            limiteDiario={config.limiteDiario}
            ritmo={config.ritmo}
            uso={config.uso}
            cola={cola}
            avisos={config.avisos}
            reparto={reparto}
          />
        )}
      </div>

      <CaptacionesList
        initialData={primeraPagina.filas as any}
        initialTotal={primeraPagina.total}
        eliminadas={eliminadas as any}
        total={total}
        totalSinAgente={totalSinAgente}
        totalAgendadas={totalAgendadas}
        totalPendientes={totalPendientes}
        isAdmin={isAdmin}
        agentes={agentes}
      />
    </div>
  )
}
