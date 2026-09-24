import { CalendarDays } from "lucide-react"
import { sesionActual } from "@/lib/auth/acceso"
import { getAgendaMes } from "@/lib/actions/agenda"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import { EntradasVencidas, ProximasEntradas } from "@/components/agenda/proximas-entradas"

export const metadata = { title: "Calendario — mkgenia" }

/**
 * El calendario tiene página propia además del bloque de Mi día: allí se mira
 * de reojo lo de hoy, y aquí se planifica la semana. Es la misma agenda, con
 * sitio para respirar y una columna de lo que viene.
 *
 * Sin permiso configurable: la agenda de uno mismo no es una sección que tenga
 * sentido conceder o denegar.
 */
export default async function CalendarioPage() {
  const sesion = await sesionActual()
  // El catálogo baja hasta el panel para que el desplegable de tipos sea el de
  // /configuracion/catalogos y no una lista escrita en el código. Es lo que
  // hace que "Visita" (migración 034) se pueda elegir aquí sin tocar nada más.
  const [agenda, catalogos] = await Promise.all([getAgendaMes(), getCatalogosActivos()])

  // Aquí se armaba la lista de tipos del catálogo ("cita, visita, recordatorio
  // y nota") para meterla en el subtítulo. El subtítulo ya no la dice: los
  // tipos se ven en el propio calendario y en el desplegable de Añadir, así que
  // enumerarlos arriba era repetir lo que hay debajo. El catálogo sigue bajando
  // al panel, que es quien lo necesita de verdad.

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <CalendarDays className="h-6 w-6 text-violet-500" />
            Calendario
          </h1>
          {/* Sin la coletilla de antes. El administrador leía "Lo que tiene
              apuntado el equipo: cita, visita, recordatorio y nota. Puedes
              apuntarle cosas a cualquiera": la lista de tipos la tiene delante
              en el propio calendario, y que se pueda apuntar a un compañero se
              descubre solo al pulsar Añadir, donde está el desplegable. */}
          <p className="text-sm text-muted-foreground mt-1">
            {sesion.isAdmin ? "Agenda del equipo" : "Tu agenda"}
          </p>
        </div>
      </div>

      {agenda.disponible ? (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
          <AgendaPanel
            entradasIniciales={agenda.entradas}
            personas={agenda.personas}
            yoId={agenda.yoId}
            isAdmin={agenda.isAdmin}
            grande
            catalogos={catalogos}
          />
          {/* Lo vencido, POR ENCIMA de lo que viene: es lo urgente y es lo
              único que la rejilla del mes no puede enseñar, porque una cita de
              mayo no sale mirando septiembre. Sin vencidas el bloque no se
              pinta y aquí queda sólo "Lo que viene", sin hueco: el espacio lo
              pone el gap del padre, no un margen del hijo. */}
          <div className="flex flex-col gap-6">
            <EntradasVencidas
              entradas={agenda.vencidas}
              ocultas={agenda.vencidasOcultas}
              personas={agenda.personas}
              yoId={agenda.yoId}
              isAdmin={agenda.isAdmin}
            />
            <ProximasEntradas
              entradas={agenda.entradas}
              personas={agenda.personas}
              yoId={agenda.yoId}
              isAdmin={agenda.isAdmin}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground max-w-lg">
          <p className="text-foreground font-medium mb-2">La agenda todavía no tiene dónde guardar</p>
          <p className="leading-relaxed">
            Falta ejecutar la migración{" "}
            <code className="text-foreground">supabase/migrations/009_agenda.sql</code> en el editor
            SQL de Supabase. En cuanto esté, esta página funciona sin tocar nada más.
          </p>
        </div>
      )}
    </div>
  )
}
