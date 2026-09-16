import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  horaDe, inicioDiaMadrid, tipoDe,
  type EntradaAgenda, type EntradaVencida, type PersonaAgenda,
} from "@/lib/agenda"

/**
 * El día de una entrada, en corto: "mié, 20 may". En hora de MADRID.
 *
 * Estas dos listas se pintan enteras en el servidor, que en producción va en
 * UTC: sin `timeZone`, una entrada de "todo el día" —que se guarda como el
 * 00:00 de Madrid, o sea las 22:00Z del día anterior— se leía con la fecha del
 * día de antes. Justo la fila que más falta hace que diga bien el día.
 */
function diaCorto(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid",
  })
}

/**
 * Lo que se pasó de fecha y sigue sin hacer.
 *
 * Va por encima de "Lo que viene" porque es lo que de verdad urge, y porque es
 * lo único que "Lo que viene" NO puede enseñar: aquella lista empieza en hoy y
 * termina catorce días después, así que lo vencido queda fuera por definición.
 * De ahí venía la queja: la tarjeta "Mi calendario" decía 1 y al entrar no
 * había nada que ver.
 *
 * Sin vencidas NO SE PINTA NADA. Un bloque vacío titulado "Vencidas" sería ruido
 * fijo en la pantalla de quien lo lleva todo al día, que es la mayoría de los
 * días.
 */
export function EntradasVencidas({
  entradas, ocultas, personas, yoId, isAdmin,
}: {
  entradas: EntradaVencida[]
  /** Las que no cupieron en el tope del servidor. */
  ocultas: number
  personas: PersonaAgenda[]
  yoId: string
  isAdmin: boolean
}) {
  if (entradas.length === 0) return null

  const nombreDe = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? "—"

  return (
    <div className="rounded-xl border border-rose-500/40 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Vencidas · {entradas.length + ocultas}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Pasadas de fecha y sin hacer, de lo más viejo a lo más reciente
          </p>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-1.5 max-h-[22rem] overflow-y-auto scrollbar-thin">
        {entradas.map((e) => {
          const t = tipoDe(e.tipo)
          return (
            <div
              key={e.id}
              className="rounded-lg border border-border border-l-2 border-l-rose-500 bg-rose-500/[0.04] px-3 py-2 flex flex-col gap-1"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.punto)} />
                <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {e.desdeHaceTexto}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {diaCorto(e.fecha)}
                  {!e.todo_el_dia && ` · ${horaDe(e.fecha)}`}
                </span>
              </div>
              <p className="text-sm leading-snug">{e.titulo}</p>
              {isAdmin && e.agente_id !== yoId && (
                <p className="text-[10px] text-muted-foreground/70">Para {nombreDe(e.agente_id)}</p>
              )}
            </div>
          )
        })}

        {ocultas > 0 && (
          <p className="text-[11px] text-muted-foreground/80 px-1">
            Hay {ocultas} {ocultas === 1 ? "vencida más" : "vencidas más"}, más
            {ocultas === 1 ? " reciente" : " recientes"} que estas. Ve tachando las de arriba y
            saldrán solas.
          </p>
        )}
      </div>
    </div>
  )
}

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
  /**
   * Los cortes del día, en hora de MADRID y no en la del servidor.
   *
   * Aquí había `setHours(0, 0, 0, 0)`, que es la medianoche de QUIEN PINTA. En
   * producción eso es UTC, o sea las 02:00 de Madrid en verano, y abría un
   * agujero de dos horas justo donde se guardan las entradas de "todo el día"
   * de hoy (el 00:00 de Madrid = 22:00Z de ayer): el bloque de vencidas no las
   * coge —cortan en el 00:00 de Madrid, y con razón, porque no están vencidas—
   * y esta lista tampoco, por empezar dos horas más tarde. La tarjeta "Mi
   * calendario" sí las cuenta, en su casilla de "hoy" (dashboard/page.tsx:823,
   * que corta con el mismo `inicioDiaMadrid`), así que era otra vez el mismo
   * cuento: un número arriba que abajo no aparece por ningún lado.
   *
   * Con los cortes en Madrid, los dos bloques se tocan sin dejar hueco: lo de
   * días pasados arriba, de hoy en adelante aquí.
   */
  const ahora = new Date()
  const hoy0 = inicioDiaMadrid(ahora).getTime()
  const manana0 = inicioDiaMadrid(ahora, 1).getTime()
  const pasado0 = inicioDiaMadrid(ahora, 2).getTime()
  const tope = inicioDiaMadrid(ahora, 14).getTime()

  /**
   * Doce filas como mucho, y las que no caben SE DICEN.
   *
   * Una columna lateral no es un listado: pasada la docena hay que rodar para
   * ver el final y deja de contestarse de un vistazo. Pero recortar en silencio
   * es exactamente lo que se acaba de quitar de encima en el bloque de arriba
   * —un número que promete y una pantalla que no entrega—, y aquí el recorte
   * llevaba puesto desde el principio. Se cuenta en la última línea.
   *
   * `pendientes.length` no mide un select: son las filas de la ventana de seis
   * semanas que ya están en memoria, filtradas otra vez aquí.
   */
  const TOPE_LISTA = 12
  const pendientes = entradas
    .filter((e) => !e.completado)
    .filter((e) => {
      const f = new Date(e.fecha).getTime()
      return f >= hoy0 && f < tope
    })
  const proximas = pendientes.slice(0, TOPE_LISTA)
  const sinSitio = pendientes.length - proximas.length

  const nombreDe = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? "—"

  // "Hoy" y "Mañana" se deciden comparando INSTANTES contra esos mismos cortes,
  // no comparando claves de día armadas con la fecha del servidor: si no, una
  // entrada de todo el día de hoy se etiquetaría con la fecha de ayer.
  function comoDia(iso: string) {
    const f = new Date(iso).getTime()
    if (f < manana0) return "Hoy"
    if (f < pasado0) return "Mañana"
    return diaCorto(iso)
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
          // Ya ha pasado el filtro de arriba, así que estar por debajo del
          // corte de mañana es estar en el día de hoy.
          const esHoyMismo = new Date(e.fecha).getTime() < manana0
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

        {sinSitio > 0 && (
          <p className="text-[11px] text-muted-foreground/80 px-1">
            Y {sinSitio} {sinSitio === 1 ? "cosa más" : "cosas más"} en estos catorce días. Están
            todas en la rejilla del mes, día por día.
          </p>
        )}
      </div>
    </div>
  )
}
