import { cn } from "@/lib/utils"
import { claveDia, horaDe, tipoDe, type EntradaAgenda, type PersonaAgenda } from "@/lib/agenda"

/**
 * Lo que viene, en lista.
 *
 * La rejilla del mes contesta "qué hay el día 17"; esta columna contesta "qué
 * tengo encima", que es la pregunta de verdad al abrir el calendario por la
 * mañana. Se queda en los próximos catorce días: más allá, una lista deja de
 * ser una lista.
 */
export function ProximasEntradas({
  entradas, personas, yoId, isAdmin,
}: {
  entradas: EntradaAgenda[]
  personas: PersonaAgenda[]
  yoId: string
  isAdmin: boolean
}) {
  const ahora = new Date()
  const hoy0 = new Date(ahora)
  hoy0.setHours(0, 0, 0, 0)
  const tope = new Date(hoy0)
  tope.setDate(tope.getDate() + 14)

  const proximas = entradas
    .filter((e) => !e.completado)
    .filter((e) => {
      const f = new Date(e.fecha)
      return f >= hoy0 && f < tope
    })
    .slice(0, 12)

  const nombreDe = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? "—"
  const claveHoy = claveDia(ahora)
  const claveManana = claveDia(new Date(hoy0.getTime() + 24 * 60 * 60 * 1000))

  function comoDia(iso: string) {
    const k = claveDia(iso)
    if (k === claveHoy) return "Hoy"
    if (k === claveManana) return "Mañana"
    return new Date(iso).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Lo que viene</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">Próximos 14 días, sin lo ya hecho</p>
      </div>

      <div className="p-3 space-y-1.5 max-h-[28rem] overflow-y-auto scrollbar-thin">
        {proximas.length === 0 && (
          <p className="text-xs text-muted-foreground/70 py-8 text-center">
            No hay nada pendiente en las próximas dos semanas.
          </p>
        )}

        {proximas.map((e) => {
          const t = tipoDe(e.tipo)
          const esHoyMismo = claveDia(e.fecha) === claveHoy
          return (
            <div key={e.id} className="rounded-lg border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.punto)} />
                <span className={cn(
                  "text-[11px] font-medium",
                  esHoyMismo ? "text-violet-500" : "text-muted-foreground",
                )}>
                  {comoDia(e.fecha)}
                </span>
                {!e.todo_el_dia && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">{horaDe(e.fecha)}</span>
                )}
              </div>
              <p className="text-sm leading-snug">{e.titulo}</p>
              {isAdmin && e.agente_id !== yoId && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">Para {nombreDe(e.agente_id)}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
