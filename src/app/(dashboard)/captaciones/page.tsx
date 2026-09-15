import { getCaptaciones, getCaptacionesEliminadas, getCaptacionesEliminadasPorAgente, getAgentes, getTotalesCaptaciones } from "@/lib/actions/captaciones"
import { getAutoContactoConfig, getEstadoCola } from "@/lib/actions/captaciones-config"
import { CaptacionesList } from "@/components/captaciones/captaciones-list"
import { CaptacionesConfig } from "@/components/captaciones/captaciones-config"
import { exigirModulo } from "@/lib/auth/acceso"
import { getEstadoAsignacion } from "@/lib/actions/asignacion"
import { getCatalogosActivos } from "@/lib/actions/catalogos"

export const metadata = { title: "Captaciones — mkgenia" }

export default async function CaptacionesPage() {
  const { userId, isAdmin } = await exigirModulo("captaciones")

  const [primeraPagina, eliminadas, config, agentes, cola, reparto, totales, catalogos] = await Promise.all([
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
    getTotalesCaptaciones(),
    // De aquí salen las pastillas de la lista: nombre, color y orden de cada
    // estado, tal y como estén en /configuracion/catalogos.
    getCatalogosActivos(),
  ])

  // De la base de datos y no de la lista: la lista sólo trae la página que se
  // ve, y contar sobre ella daría 50 pase lo que pase.
  const { total, porEstado: totalesEstado, porSenal: totalesSenal, conSenal } = totales

  // Los interesados ya no se suman aquí. Hasta la 027 eran dos estados
  // (`Interesado` + `Quiere_Llamada`) y había que sumarlos a mano; ahora son una
  // columna propia, `senal`, y el número lo cuenta la base de datos de una vez.
  // Si ese contador falló llega como null y el subtítulo se queda sin la
  // coletilla, que es mejor que enseñar un 0 que se lee como "no hay ninguno".
  const interesados = conSenal

  return (
    // El hueco entre la cabecera y la lista lo pone el `gap` de aquí, no un
    // `mb-` en la cabecera: el hijo no tiene por qué saber qué lleva debajo.
    // Los overlays de la lista (ficha y diálogos) son `fixed`, así que quedan
    // fuera del flujo y el `gap` no les afecta.
    <div className="p-8 flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {isAdmin ? "Captaciones" : "Mis captaciones"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {/* Interesados = los que tienen señal, sea "Le interesa" o "Quiere
                llamada": en los dos casos es un propietario que ha dicho que sí
                y espera una llamada. Es el mismo criterio con el que reparte el
                trigger y con el que cuenta la tarjeta del scraper en la
                portada, para que los tres sitios digan siempre lo mismo. */}
            {total.toLocaleString("es")} {isAdmin ? "propiedades" : "captaciones asignadas"}
            {interesados !== null && ` · ${interesados.toLocaleString("es")} interesados`}
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
        initialData={primeraPagina.filas}
        initialTotal={primeraPagina.total}
        eliminadas={eliminadas}
        total={total}
        totalesEstado={totalesEstado}
        totalesSenal={totalesSenal}
        catalogos={catalogos}
        isAdmin={isAdmin}
        agentes={agentes}
      />
    </div>
  )
}
