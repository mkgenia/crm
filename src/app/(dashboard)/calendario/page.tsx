import { CalendarDays } from "lucide-react"
import { sesionActual } from "@/lib/auth/acceso"
import { getAgendaMes } from "@/lib/actions/agenda"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { opcionesDe } from "@/lib/catalogos"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import { ProximasEntradas } from "@/components/agenda/proximas-entradas"

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

  // Los tipos, nombrados uno a uno tal y como estén hoy en el catálogo. Antes
  // ponía "Citas, notas y recordatorios", que era la lista de 2025 escrita a
  // mano: el día que entró la visita, el subtítulo seguía sin nombrarla.
  const nombresTipos = opcionesDe(catalogos, "tipo_agenda").map((t) => t.nombre.toLowerCase())
  const listaTipos = nombresTipos.length
    ? nombresTipos.length === 1
      ? nombresTipos[0]
      : `${nombresTipos.slice(0, -1).join(", ")} y ${nombresTipos[nombresTipos.length - 1]}`
    : "lo apuntado"

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2.5">
            <CalendarDays className="h-6 w-6 text-violet-500" />
            Calendario
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sesion.isAdmin
              ? `Lo que tiene apuntado el equipo: ${listaTipos}. Puedes apuntarle cosas a cualquiera.`
              : `Lo tuyo: ${listaTipos}.`}
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
          <ProximasEntradas
            entradas={agenda.entradas}
            personas={agenda.personas}
            yoId={agenda.yoId}
            isAdmin={agenda.isAdmin}
          />
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
