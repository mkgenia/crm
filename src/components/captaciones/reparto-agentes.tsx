"use client"

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Building2, GripVertical, Inbox, Loader2, UserMinus, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  cambiarModo, cambiarReglas, cambiarDisponibilidad, reordenarRotacion,
  fueraDeRotacion, repartirPendientes, repartirLeadsPendientes,
  type EstadoAsignacion, type ModoAsignacion,
} from "@/lib/actions/asignacion"

/**
 * A quién le toca cada cosa: las captaciones del scraper y los leads de demanda.
 *
 * Vive dentro de la configuración del scraper y no en una pantalla propia
 * porque aquí es donde se decide qué se captura y a qué ritmo se escribe, y el
 * reparto es la continuación de eso.
 *
 * Las dos colas comparten el interruptor manual/automático y comparten la
 * rotación, porque el turno es uno solo: si hubiera dos, al agente le caerían
 * dos primeras posiciones y el reparto dejaría de ser justo. Lo que NO
 * comparten es cuándo saltan, y por eso el panel lo dice con todas las letras:
 * no hay forma de adivinarlo mirando un interruptor que pone "automático".
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
  const fuera = estado.agentes.filter((a) => a.orden_reparto === null)

  // El orden local manda —es el que el arrastre acaba de cambiar, antes de que
  // el servidor conteste—, pero se cruza con lo que dice el servidor: el que ya
  // no está en el turno desaparece de aquí, y el que haya entrado por otro lado
  // sale al final. Sin ese cruce, pulsar "sacar del turno" dejaba al agente
  // arriba en la rotación (su id sigue en `orden`) Y abajo en "fuera del
  // turno": el mismo nombre en dos sitios hasta recargar la página entera.
  const enRotacion = [
    ...orden.map((id) => porId.get(id)).filter((a) => !!a && a.orden_reparto !== null),
    ...estado.agentes.filter((a) => a.orden_reparto !== null && !orden.includes(a.id)),
  ] as typeof estado.agentes

  // A quién le toca la siguiente: el primero por detrás del cursor, y si no hay
  // ninguno se vuelve al principio. Es la misma regla que aplica el SQL, y
  // enseñarla es lo que convierte esta lista en algo que se puede comprobar.
  const disponibles = enRotacion.filter((a) => a.disponible)
  const leToca = disponibles.find((a) => (a.orden_reparto ?? 0) > estado.cursor) ?? disponibles[0]
  // Si la plantilla no se pudo leer, la lista vacía no quiere decir "no hay
  // nadie": quiere decir que no lo sabemos, y entonces no se apagan los botones.
  // Es lo mismo que con un contador a null: quien manda sobre lo que se puede
  // repartir es la RPC, y si de verdad no hay nadie disponible lo dirá ella con
  // su error. Apagarlos por un fallo de lectura deja al dueño sin poder repartir
  // algo que sí se habría repartido.
  const hayQuienCoja = disponibles.length > 0 || !estado.agentesLeidos

  function correr(fn: () => Promise<{ ok?: true; error?: string }>, exito?: string) {
    empezar(async () => {
      // `.catch` y no sólo `try/finally`: si la acción revienta de verdad —la
      // red se cae, el servidor se está reiniciando— la promesa se rompe, y sin
      // esto el transition no termina nunca: el panel se queda girando para
      // siempre y el usuario no llega a saber qué ha pasado.
      const r = await fn().catch((e: unknown) => ({
        ok: undefined,
        error: e instanceof Error ? e.message : "No se ha podido guardar el cambio",
      }))
      if (r.error) { toast.error(r.error); return }
      if (exito) toast.success(exito)
      router.refresh()
    })
  }

  /** "12 repartidas · quedan 38", pero sin inventarse el "quedan" si no se pudo contar. */
  function resumen(hechos: number, quedan: number | null | undefined, que: string) {
    return quedan === null || quedan === undefined
      ? `${hechos} ${que}`
      : `${hechos} ${que} · quedan ${quedan}`
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
            ["manual", "Manual"],
            ["automatico", "Automático"],
          ] as Array<[ModoAsignacion, string]>).map(([valor, etiqueta]) => (
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
            ? "Captaciones y leads entran sin agente y esperan abajo, en sus dos colas. Es como funciona hoy."
            : "Cada captación y cada lead nuevo se asigna solo al siguiente agente del turno. Sólo afecta a lo que entre a partir de ahora: lo que ya está esperando se reparte con los botones de abajo."}
        </p>

        {/*
          Lo que el interruptor no puede contar por sí solo. Sin esto, "automático"
          se lee como "todo se reparte al entrar", y entonces las captaciones
          parecen estar rotas: se quedan quietas hasta que el propietario contesta.
        */}
        <div className="rounded-md bg-muted/40 px-3 py-2.5 flex flex-col gap-1.5">
          <p className="text-[11px] font-medium">
            El modo y el turno son los mismos para los dos, pero no saltan a la vez
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Una captación</span> se reparte cuando la
            IA ve señal de interés en lo que contesta el propietario. Contestar no basta, y antes de
            eso es un anuncio al que nadie ha escrito: el que trabaja es el bot.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Un lead de Instagram o de la web</span> se
            reparte en cuanto entra. Rellenar el formulario ya es el interés: no hay nada que esperar.
          </p>
        </div>

        <label className="flex items-start gap-2.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={estado.reglas.continuidad}
            onChange={(e) => correr(() => cambiarReglas({ continuidad: e.target.checked }))}
            disabled={guardando}
            // translate y no margen: estos 2px son alineación óptica con la
            // primera línea de texto, no espaciado entre elementos.
            className="translate-y-0.5 accent-violet-500"
          />
          <span>
            <span className="font-medium">Continuidad</span>
            <span className="text-muted-foreground">
              {" "}— si ya llamamos a ese teléfono, lo siguiente que entre suyo va al mismo agente,
              venga por el scraper o por la landing. Evita que la misma persona reciba dos llamadas
              de dos compañeros distintos.
            </span>
          </span>
        </label>
      </div>

      {/* Rotación */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col gap-0.5">
          <p className="text-xs font-medium">Orden del turno</p>
          <p className="text-[11px] text-muted-foreground">
            Uno solo para las dos colas. Arrastra para cambiarlo; quien no esté disponible se salta
            y no guarda turno. Los dos números son lo que lleva abierto en su pantalla: captaciones
            y prospectos / leads.
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

              {/*
                Un guion donde no se pudo contar, nunca un 0: un cero al lado de
                un nombre se lee como "éste está libre, cárgale más", que es la
                decisión contraria a la que tocaría tomar con un dato que falló.
              */}
              <span
                className="text-[11px] text-muted-foreground tabular-nums shrink-0 flex items-center gap-1"
                title={
                  a.captacionesAbiertas === null || a.leadsAbiertos === null
                    ? "No se ha podido contar lo que lleva abierto"
                    : `${a.captacionesAbiertas} captaciones o prospectos y ${a.leadsAbiertos} leads abiertos`
                }
              >
                <span>{a.captacionesAbiertas ?? "—"}</span>
                <span className="opacity-40">/</span>
                <span>{a.leadsAbiertos ?? "—"}</span>
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
              {/*
                "No hay nadie" y "no se ha podido leer" salen las dos como una
                lista vacía, pero son cosas distintas: la primera se arregla
                metiendo agentes en el turno y la segunda recargando. Decir la
                primera cuando pasa la segunda manda al dueño a tocar la
                rotación, que es justo lo que no falla.
              */}
              {estado.agentesLeidos
                ? "No hay nadie en el turno. Sin agentes en la rotación no se puede repartir nada, ni captaciones ni leads."
                : "No se ha podido leer la plantilla, así que no se sabe quién está en el turno. Los botones siguen activos: quien reparte de verdad es la base de datos."}
            </p>
          )}
        </div>

        {fuera.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex flex-col gap-1">
            <p className="text-[11px] text-muted-foreground">
              Fuera del turno — siguen trabajando lo suyo, pero no les entra nada nuevo
            </p>
            <p className="text-xs">{fuera.map((a) => a.nombre).join(", ")}</p>
          </div>
        )}
      </div>

      {/* Las dos colas */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-col gap-0.5">
          <p className="text-xs font-medium">Esperando agente</p>
          <p className="text-[11px] text-muted-foreground">
            De 50 en 50, para poder mirar cómo han caído antes de seguir.
          </p>
        </div>

        <div className="flex flex-col divide-y divide-border">
          <Cola
            icono={<Building2 className="h-3.5 w-3.5" />}
            pendientes={estado.captacionesPendientes}
            etiqueta="captaciones con señal esperando"
            vacio="Ninguna captación con señal esperando"
            regla="Sólo entran aquéllas en las que la IA ha visto señal de interés al contestar el propietario. Haber contestado no basta: las demás siguen siendo del bot."
            puedeRepartir={hayQuienCoja}
            guardando={guardando}
            onRepartir={() => empezar(async () => {
              const r = await repartirPendientes(50).catch((e: unknown) => ({
                error: e instanceof Error ? e.message : "No se ha podido repartir",
                repartidas: undefined, quedan: undefined,
              }))
              if (r.error) { toast.error(r.error); return }
              toast.success(resumen(r.repartidas ?? 0, r.quedan, "captaciones repartidas"))
              router.refresh()
            })}
          />

          <Cola
            icono={<Inbox className="h-3.5 w-3.5" />}
            pendientes={estado.leadsPendientes}
            etiqueta="leads sin asignar"
            vacio="Ningún lead sin asignar"
            regla="Los de Instagram y los de la ficha de una propiedad. No cuentan los leads espejo de una captación: ésos se reparten por el lado de la captación, para no repartir dos veces al mismo propietario."
            puedeRepartir={hayQuienCoja}
            guardando={guardando}
            onRepartir={() => empezar(async () => {
              const r = await repartirLeadsPendientes(50).catch((e: unknown) => ({
                error: e instanceof Error ? e.message : "No se ha podido repartir",
                repartidos: undefined, quedan: undefined,
              }))
              if (r.error) { toast.error(r.error); return }
              toast.success(resumen(r.repartidos ?? 0, r.quedan, "leads repartidos"))
              router.refresh()
            })}
          />
        </div>

        {!hayQuienCoja && (
          <p className="px-4 py-3 border-t border-border text-[11px] text-muted-foreground">
            No hay nadie disponible en el turno, así que no se puede repartir ninguna de las dos
            colas.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Una cola con su botón.
 *
 * El número sale de un count(*) hecho en la base, y puede venir a `null` cuando
 * esa cuenta falla. En ese caso se dice que no se ha podido contar en vez de
 * pintar un 0: un cero se lee como "ya está todo repartido" y el dueño no
 * volvería a pulsar el botón en su vida. Y en ese mismo caso —contador a null,
 * no a 0— el botón sigue habilitado, porque quien manda de verdad sobre lo que
 * hay pendiente es la RPC, no este contador. Con un 0 de verdad sí se apaga: ahí
 * la base ha dicho que no queda nada.
 */
function Cola({
  icono, pendientes, etiqueta, vacio, regla, puedeRepartir, guardando, onRepartir,
}: {
  icono: ReactNode
  pendientes: number | null
  etiqueta: string
  vacio: string
  regla: string
  puedeRepartir: boolean
  guardando: boolean
  onRepartir: () => void
}) {
  const estaVacia = pendientes === 0

  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex flex-col gap-1">
        <p className="text-sm flex items-center gap-2">
          <span className="text-muted-foreground shrink-0">{icono}</span>
          {pendientes === null ? (
            <span className="text-muted-foreground">No se ha podido contar esta cola</span>
          ) : estaVacia ? (
            <span className="text-muted-foreground">{vacio}</span>
          ) : (
            <span>
              <span className="font-medium tabular-nums">{pendientes}</span> {etiqueta}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{regla}</p>
      </div>

      <button
        onClick={onRepartir}
        disabled={guardando || !puedeRepartir || estaVacia}
        className="shrink-0 h-9 px-3 rounded-md border border-border text-xs font-medium hover:bg-muted/60 transition-colors flex items-center gap-1.5 disabled:opacity-50"
      >
        <Shuffle className="h-3.5 w-3.5" />
        Repartir 50
      </button>
    </div>
  )
}
