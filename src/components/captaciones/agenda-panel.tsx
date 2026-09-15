"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { asignarAgenda } from "@/lib/actions/captaciones"
import { toast } from "sonner"
import { Loader2, ArrowLeftRight, X } from "lucide-react"
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
            {/* El icono NO lleva margen: <Button> ya separa con su propio gap. */}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setTraspasando(true)}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Traspasar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {asignada && !traspasando && (
              <p className="text-xs text-muted-foreground">
                El agente asignado ya no está en la lista. Elige uno para reasignarla.
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
