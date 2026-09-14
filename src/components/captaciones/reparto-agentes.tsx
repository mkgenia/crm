"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GripVertical, Loader2, UserMinus, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  cambiarModo, cambiarReglas, cambiarDisponibilidad, reordenarRotacion,
  fueraDeRotacion, repartirPendientes,
  type EstadoAsignacion, type ModoAsignacion,
} from "@/lib/actions/asignacion"

/**
 * A quién le toca cada captación.
 *
 * Vive dentro de la configuración del scraper y no en una pantalla propia: lo
 * que se reparte son las captaciones que saca el captador, así que se decide en
 * el mismo sitio donde se decide qué se captura y a qué ritmo se escribe.
 */
export function RepartoAgentes({ estado }: { estado: EstadoAsignacion }) {
  const router = useRouter()
  const [guardando, empezar] = useTransition()
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [encima, setEncima] = useState<string | null>(null)
  const [orden, setOrden] = useState<string[]>(
    estado.agentes.filter((a) => a.orden_reparto !== null).map((a) => a.id)
  )

  const porId = new Map(estado.agentes.map((a) => [a.id, a]))
  const enRotacion = orden.map((id) => porId.get(id)).filter(Boolean) as typeof estado.agentes
  const fuera = estado.agentes.filter((a) => a.orden_reparto === null)

  // A quién le toca la siguiente: el primero por detrás del cursor, y si no hay
  // ninguno se vuelve al principio. Es la misma regla que aplica el SQL, y
  // enseñarla es lo que convierte esta lista en algo que se puede comprobar.
  const disponibles = enRotacion.filter((a) => a.disponible)
  const leToca = disponibles.find((a) => (a.orden_reparto ?? 0) > estado.cursor) ?? disponibles[0]

  function correr(fn: () => Promise<{ ok?: true; error?: string }>, exito?: string) {
    empezar(async () => {
      const r = await fn()
      if (r.error) { toast.error(r.error); return }
      if (exito) toast.success(exito)
      router.refresh()
    })
  }

  function soltarEn(destino: string) {
    if (!arrastrando || arrastrando === destino) return
    const sinEl = orden.filter((id) => id !== arrastrando)
    // El +1 es lo que permite dejar a alguien el ÚLTIMO: insertando siempre por
    // encima del destino, la última posición era inalcanzable.
    const i = sinEl.indexOf(destino)
    const iDestinoOriginal = orden.indexOf(destino)
    const iArrastrado = orden.indexOf(arrastrando)
    sinEl.splice(iArrastrado < iDestinoOriginal ? i + 1 : i, 0, arrastrando)
    setOrden(sinEl)
    setArrastrando(null)
    setEncima(null)
    correr(() => reordenarRotacion(sinEl), "Orden guardado")
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Reparto entre agentes
        </p>
        {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* Modo */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex rounded-lg border border-border bg-background p-0.5">
          {([
            ["manual", "Manual", "Las captaciones esperan a que las repartas tú"],
            ["automatico", "Automático", "Cada captación nueva va al siguiente del turno"],
          ] as Array<[ModoAsignacion, string, string]>).map(([valor, etiqueta]) => (
            <button
              key={valor}
              onClick={() => correr(() => cambiarModo(valor), `Reparto ${valor === "manual" ? "manual" : "automático"}`)}
              disabled={guardando}
              className={cn(
                "flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-50",
                estado.modo === valor
                  ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {estado.modo === "manual"
            ? "Las captaciones nuevas entran sin agente y esperan aquí. Es como funciona hoy."
            : "Cada captación nueva se asigna sola al siguiente agente del turno. Sólo afecta a las que entren a partir de ahora."}
        </p>

        <label className="flex items-start gap-2.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={estado.reglas.continuidad}
            onChange={(e) => correr(() => cambiarReglas({ continuidad: e.target.checked }))}
            disabled={guardando}
            className="mt-0.5 accent-violet-500"
          />
          <span>
            <span className="font-medium">Continuidad</span>
            <span className="text-muted-foreground">
              {" "}— si ya llamamos a ese teléfono, la siguiente captación suya va al mismo agente.
              Evita que un propietario reciba dos llamadas de dos personas distintas.
            </span>
          </span>
        </label>
      </div>

      {/* Rotación */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-medium">Orden del turno</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Arrastra para cambiarlo. Quien no esté disponible se salta, no guarda turno.
          </p>
        </div>

        <div className="p-2 flex flex-col gap-1">
          {enRotacion.map((a, i) => (
            <div
              key={a.id}
              draggable
              onDragStart={(e) => {
                setArrastrando(a.id)
                e.dataTransfer.effectAllowed = "move"
                // Firefox no emite dragover ni drop si no se escriben datos.
                e.dataTransfer.setData("text/plain", a.id)
              }}
              onDragEnd={() => { setArrastrando(null); setEncima(null) }}
              onDragOver={(e) => { e.preventDefault(); setEncima(a.id) }}
              onDragLeave={() => setEncima((x) => (x === a.id ? null : x))}
              onDrop={(e) => { e.preventDefault(); soltarEn(a.id) }}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors",
                arrastrando === a.id && "opacity-40",
                encima === a.id && arrastrando !== a.id && "ring-1 ring-violet-500/50",
                a.id === leToca?.id ? "bg-violet-500/10" : "hover:bg-muted/40",
              )}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
              <span className="text-[11px] tabular-nums text-muted-foreground w-4 shrink-0">{i + 1}</span>

              <span className={cn("text-sm flex-1 min-w-0 truncate", !a.disponible && "text-muted-foreground line-through")}>
                {a.nombre}
              </span>

              {a.id === leToca?.id && (
                <span className="text-[10px] font-medium text-violet-600 dark:text-violet-300 shrink-0">
                  le toca
                </span>
              )}

              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {a.captacionesAbiertas}
              </span>

              <button
                onClick={() => correr(
                  () => cambiarDisponibilidad(a.id, !a.disponible),
                  a.disponible ? `${a.nombre} no disponible` : `${a.nombre} disponible`
                )}
                disabled={guardando}
                className={cn(
                  "h-5 w-9 rounded-full transition-colors shrink-0 relative disabled:opacity-50",
                  a.disponible ? "bg-emerald-500/70" : "bg-muted-foreground/30",
                )}
                aria-label={a.disponible ? `Marcar a ${a.nombre} como no disponible` : `Marcar a ${a.nombre} como disponible`}
              >
                <span className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                  a.disponible ? "left-[1.125rem]" : "left-0.5",
                )} />
              </button>

              <button
                onClick={() => correr(() => fueraDeRotacion(a.id), `${a.nombre} fuera del turno`)}
                disabled={guardando}
                className="text-muted-foreground hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
                aria-label={`Sacar a ${a.nombre} del turno`}
              >
                <UserMinus className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {enRotacion.length === 0 && (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No hay nadie en el turno. Sin agentes en la rotación, el reparto automático no puede asignar nada.
            </p>
          )}
        </div>

        {fuera.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex flex-col gap-1">
            <p className="text-[11px] text-muted-foreground">
              Fuera del turno — siguen trabajando lo suyo, pero no les entran captaciones nuevas
            </p>
            <p className="text-xs">{fuera.map((a) => a.nombre).join(", ")}</p>
          </div>
        )}
      </div>

      {/* El atasco */}
      {estado.sinAsignar > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm">
              <span className="font-medium tabular-nums">{estado.sinAsignar}</span>
              {" "}captaciones sin agente
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              De 50 en 50, para poder mirar el resultado antes de seguir
            </p>
          </div>
          <button
            onClick={() => empezar(async () => {
              const r = await repartirPendientes(50)
              if (r.error) { toast.error(r.error); return }
              toast.success(`${r.repartidas} repartidas · quedan ${r.quedan}`)
              router.refresh()
            })}
            disabled={guardando || enRotacion.filter((a) => a.disponible).length === 0}
            className="shrink-0 h-9 px-3 rounded-md border border-border text-xs font-medium hover:bg-muted/60 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Repartir 50
          </button>
        </div>
      )}
    </section>
  )
}
