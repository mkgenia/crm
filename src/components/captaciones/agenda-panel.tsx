"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { asignarAgenda } from "@/lib/actions/captaciones"
import { quitarAgenteCaptaciones } from "@/lib/actions/asignacion"
import { toast } from "sonner"
import { Loader2, ArrowLeftRight, UserMinus, X } from "lucide-react"
import type { EstadoAgenda } from "@/types/captaciones"
import { cn } from "@/lib/utils"

interface Agente {
  id: string
  nombre: string
  apellidos: string | null
  avatar_url: string | null
}

interface Props {
  captacionId: number
  agentes: Agente[]
  initial: {
    agente_id: string | null
    /**
     * Estas cuatro columnas ya no las escribe este panel: lo que se apunta tras una
     * llamada va por `atender`. Se siguen aceptando (opcionales, e ignoradas) para que
     * quien renderiza el panel pueda dejar de pasarlas sin romper el tipo.
     */
    fecha_agenda?: string | null
    recordatorio_fecha?: string | null
    notas_agenda?: string | null
    estado_agenda?: EstadoAgenda
  }
  onUpdate?: () => void
}

function initials(a: Agente) {
  return `${a.nombre.charAt(0)}${a.apellidos?.charAt(0) ?? ""}`.toUpperCase()
}

/** Asignar o traspasar el agente de una captación. No hace nada más. */
export function AgendaPanel({ captacionId, agentes, initial, onUpdate }: Props) {
  const [loading, setLoading] = useState(false)
  const [quitando, setQuitando] = useState(false)
  const [traspasando, setTraspasando] = useState(false)
  /**
   * Solo guardamos la elección pendiente. El agente vigente se lee siempre de `initial`,
   * que el padre refresca al terminar, así que el panel nunca se queda con un valor viejo
   * (y no hace falta sincronizar estado con un efecto).
   */
  const [seleccion, setSeleccion] = useState<string | null>(null)

  const asignada = !!initial.agente_id
  const agenteActual = agentes.find((a) => a.id === initial.agente_id) ?? null
  /**
   * La ficha de solo lectura únicamente vale si conocemos al agente. Si la captación tiene
   * un agente_id que ya no está en la lista (perfil borrado o filtrado), caemos al selector
   * para poder reasignarla en vez de dejar el panel sin salida.
   */
  const ficha = !traspasando ? agenteActual : null
  const puedeGuardar = !!seleccion && seleccion !== initial.agente_id

  async function handleGuardar() {
    if (!puedeGuardar) return
    setLoading(true)
    const res = await asignarAgenda(captacionId, { agente_id: seleccion })
    setLoading(false)
    // Si falla se dice y el botón vuelve a su sitio: nada de spinners eternos.
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(asignada ? "Captación traspasada" : "Agente asignado")
    setTraspasando(false)
    setSeleccion(null)
    onUpdate?.()
  }

  /**
   * Dejar la captación sin agente.
   *
   * NO es un rechazo: el administrador la recoge para repartirla de otra forma,
   * así que el mismo agente puede volver a recibirla (ver `quitarAgenteCaptaciones`;
   * rechazarla lo metería en `rechazado_por` y el reparto automático no se la
   * volvería a ofrecer nunca). Hasta hoy esto no se podía hacer por pantalla:
   * "Traspasar" exige elegir a OTRO, y vaciar la cuenta de un agente había que
   * hacerlo con un script contra la base.
   *
   * Sin confirmación a propósito: tiene vuelta atrás de un clic, porque al
   * quedarse sin agente el panel enseña la rejilla para volver a dárselo a quien
   * sea.
   *
   * Y sin guardarse aquí un "ya no tiene agente": el agente vigente se lee
   * siempre de `initial`, que el padre refresca con `onUpdate`. Una copia local
   * es justo lo que este panel evita desde el principio, y sería la que se
   * quedaría vieja.
   */
  async function handleQuitar() {
    if (loading || quitando) return
    setQuitando(true)
    const res = await quitarAgenteCaptaciones([captacionId]).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : "No se ha podido quitar el agente",
    }))
    setQuitando(false)

    if (res?.error) {
      toast.error(res.error)
      return
    }

    toast.success("Captación sin asignar. Puedes dársela a otro agente aquí mismo.")
    setTraspasando(false)
    setSeleccion(null)
    onUpdate?.()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
          Agente asignado
        </Label>

        {ficha ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white shrink-0">
              {initials(ficha)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {`${ficha.nombre} ${ficha.apellidos ?? ""}`.trim()}
              </p>
              <p className="text-xs text-muted-foreground">Lleva esta captación</p>
            </div>
            {/* Los dos botones van en su propia fila con su `gap`: el `gap-3`
                del contenedor separa el bloque del nombre, y este `gap-1`
                separa "Traspasar" de "Quitar" sin que ninguno lleve margen. */}
            <div className="flex items-center gap-1 shrink-0">
              {/* El icono NO lleva margen: <Button> ya separa con su propio gap. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={quitando}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setTraspasando(true)}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Traspasar
              </Button>
              {/* "Traspasar" contesta "¿a quién?" y esto contesta "a nadie", que
                  no es un agente más de la rejilla. Sólo sale con la ficha
                  delante, o sea cuando hay agente que quitar. Este panel entero
                  lo pinta `detail-panel` sólo para el administrador, y quien de
                  verdad lo impide es la acción de servidor. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || quitando}
                title="Dejar la captación sin agente"
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                onClick={handleQuitar}
              >
                {quitando
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserMinus className="h-3.5 w-3.5" />}
                Quitar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {asignada && !traspasando && (
              /* La captación tiene agente, pero su perfil ya no sale en la lista
                 (se borró al irse de la empresa). Ése es justo el caso de
                 "vaciar la cuenta de alguien", así que aquí también tiene que
                 poder soltarse: con el botón sólo en la ficha de arriba, la
                 única salida era dársela a OTRO, y no siempre hay a quién. El
                 hueco entre el aviso y el botón lo pone este `gap`, no un
                 margen del hijo. */
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  El agente asignado ya no está en la lista. Elige uno para reasignarla, o quítaselo.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading || quitando}
                  title="Dejar la captación sin agente"
                  className="h-8 shrink-0 px-2.5 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                  onClick={handleQuitar}
                >
                  {quitando
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <UserMinus className="h-3.5 w-3.5" />}
                  Quitar
                </Button>
              </div>
            )}
            {/* Que la pantalla DIGA que no la lleva nadie, y no que haya que
                deducirlo de que salga la rejilla. Faltaba: al pulsar "Quitar",
                la ficha con el nombre desaparecía y quedaba un rótulo que
                seguía diciendo "Agente asignado" encima de una lista de
                nombres, o sea lo mismo que ve una captación que nunca se
                repartió. Con 696 activas sin agente, ese estado es un sitio
                normal y tiene que leerse a la primera. El amarillo es el mismo
                que usa la ficha de lead para el hueco sin agente. */}
            {!asignada && !traspasando && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
                Sin asignar. Elige abajo a quién se la das.
              </p>
            )}
            {traspasando && (
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setTraspasando(false)
                  setSeleccion(null)
                }}
                className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Cancelar traspaso
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {agentes.map((a) => (
                /**
                 * Bloqueados mientras se guarda: si no, se puede cambiar de agente con la
                 * petición en vuelo y al volver se limpia la selección, dejando en pantalla
                 * un agente distinto del que se acaba de grabar.
                 */
                <button
                  key={a.id}
                  type="button"
                  disabled={loading}
                  onClick={() => setSeleccion((s) => (s === a.id ? null : a.id))}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all disabled:pointer-events-none disabled:opacity-50",
                    seleccion === a.id
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                      seleccion === a.id
                        ? "bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {initials(a)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{a.nombre}</p>
                    {a.apellidos && (
                      <p className="text-xs text-muted-foreground truncate">{a.apellidos}</p>
                    )}
                  </div>
                  {a.id === initial.agente_id && (
                    <span className="text-[10px] text-muted-foreground shrink-0">actual</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* El botón solo sale cuando hay algo que guardar: sin agente conocido, o en pleno traspaso. */}
      {!ficha && (
        <Button onClick={handleGuardar} disabled={loading || !puedeGuardar} className="w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {/*
            El rótulo mira `traspasando`, no `asignada`: cuando el agente guardado ya no existe
            en la lista esto no es un traspaso, es una reasignación de una captación huérfana.
          */}
          {traspasando ? "Confirmar traspaso" : asignada ? "Reasignar agente" : "Asignar agente"}
        </Button>
      )}
    </div>
  )
}
