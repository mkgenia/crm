"use client"

import { useState, useSyncExternalStore, type JSX, type KeyboardEvent } from "react"
import { Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { atender } from "@/lib/actions/interacciones"
import { claseColor, opcionesDe, type Catalogo } from "@/lib/catalogos"

/**
 * Un botón y una caja: todo lo que hace falta para apuntar una llamada.
 *
 * Lo que había pedía agente + fecha + hora + recordatorio + estado antes de
 * dejarte escribir, y lo medido es que no se usaba: UNA nota a mano en toda la
 * historia y 735 de 737 captaciones con la agenda en "pendiente". Aquí sólo el
 * botón es obligatorio; la nota, el resultado y el recordatorio son opcionales.
 *
 * Sirve igual para una captación que para un lead porque la llamada es la
 * misma: cambia a quién se llama, no la prisa por apuntarla.
 */

const RESULTADO_CAT = "resultado_atencion"

const TZ = "Europe/Madrid"

/**
 * Los recordatorios caen a las nueve de la mañana.
 *
 * A medianoche —que es donde caería un día sin hora— el aviso queda enterrado
 * bajo lo del día siguiente antes de que nadie abra el calendario.
 */
const HORA_AVISO = 9

const ATAJOS: Array<{ dias: number; etiqueta: string }> = [
  { dias: 1, etiqueta: "mañana" },
  { dias: 3, etiqueta: "3 días" },
  { dias: 7, etiqueta: "1 semana" },
  { dias: 15, etiqueta: "15 días" },
]

/**
 * Las fechas se formatean con locale y zona fijos.
 *
 * Esta caja se pinta primero en el servidor, que corre en UTC, y luego se
 * hidrata en el navegador, que está en Madrid: si cada uno usara la suya, el
 * mismo dato saldría con una hora distinta a cada lado y React lo cantaría como
 * desajuste. Numérico y no "14 sept" por lo mismo: el ICU de Node y el del
 * navegador no siempre abrevian igual los meses.
 */
const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
})
const FECHA_HORA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
})

const PARTES = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

/**
 * El reloj, tratado como lo que es: un sistema externo a React.
 *
 * "Atendida hace 3 días" sale de Date.now(), y este componente se pinta en el
 * servidor antes de hidratarse aquí. Si el texto se calculara durante el render,
 * el HTML que llega y el que React produce al hidratar dirían cosas distintas
 * —entre uno y otro pasa tiempo, y los dos relojes ni siquiera van iguales— y
 * React lo cantaría como desajuste de hidratación. Leyéndolo con
 * useSyncExternalStore, el servidor y el primer render del cliente ven null y
 * enseñan la fecha absoluta, que sí es idéntica en los dos lados; ya hidratado,
 * React vuelve a renderizar con la hora de verdad. Mismo patrón, y por el mismo
 * motivo, que components/shared/linea-tiempo.tsx.
 */
const RELOJ = {
  subscribe(alCambiar: () => void) {
    // Cada minuto, para que no envejezca a la vista de quien deja la ficha abierta.
    const t = setInterval(alCambiar, 60_000)
    return () => clearInterval(t)
  },
  // Redondeado al minuto a propósito: getSnapshot tiene que devolver lo mismo
  // mientras nada cambie, y un Date.now() crudo renderizaría sin parar.
  ahora: () => Math.floor(Date.now() / 60_000) * 60_000,
  enServidor: () => null,
}

/** Ese instante, leído como los números que marca un reloj de pared en Madrid. */
function relojDeMadrid(ms: number) {
  const p: Record<string, string> = {}
  for (const x of PARTES.formatToParts(ms)) if (x.type !== "literal") p[x.type] = x.value
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    // Con hour12:false hay versiones de ICU que escriben la medianoche como 24.
    hora: Number(p.hour) % 24,
    min: Number(p.minute),
    seg: Number(p.second),
  }
}

/**
 * El instante UTC que en Madrid se lee como ese día a esa hora.
 *
 * Hace falta porque el servidor guarda en UTC y aquí se piensa en horario de
 * Madrid: "mañana" tiene que caer mañana EN MADRID, y en verano, entre las 00:00
 * y las 02:00, no es el mismo día en las dos zonas.
 *
 * Se resuelve en dos pasadas porque el desfase depende del propio resultado: se
 * supone que la hora de pared es UTC, se mide cuánto se desvía al leerla en
 * Madrid, se corrige, y se vuelve a medir por si esa corrección ha cruzado el
 * cambio de hora de marzo o de octubre.
 */
function instanteEnMadrid(anio: number, mes: number, dia: number, hora: number): Date {
  const pared = Date.UTC(anio, mes - 1, dia, hora)
  let ms = pared
  for (let i = 0; i < 2; i++) {
    const r = relojDeMadrid(ms)
    ms += pared - Date.UTC(r.anio, r.mes - 1, r.dia, r.hora, r.min, r.seg)
  }
  return new Date(ms)
}

/** Dentro de N días naturales contados en Madrid, a HORA_AVISO. */
function dentroDe(dias: number): string {
  const hoy = relojDeMadrid(Date.now())
  // El salto de día se hace con Date.UTC para no pelearse a mano con los meses
  // ni con los bisiestos: aquí se usa como calendario, no como instante.
  const d = new Date(Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia + dias))
  return instanteEnMadrid(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    HORA_AVISO,
  ).toISOString()
}

/** Hoy en Madrid, en el formato que entiende un input type="date". */
function hoyEnMadrid(): string {
  const h = relojDeMadrid(Date.now())
  return `${h.anio}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`
}

/** El "2026-09-18" del input, a ese día a HORA_AVISO en Madrid. */
function desdeInputFecha(valor: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!m) return null
  return instanteEnMadrid(Number(m[1]), Number(m[2]), Number(m[3]), HORA_AVISO).toISOString()
}

/** Días naturales, no bloques de 24 h: a las 00:30 "ayer" tiene que ser ayer. */
function diasNaturales(antes: number, ahora: number): number {
  const a = new Date(antes)
  const b = new Date(ahora)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * "hace 3 días". Pasada una semana ya no sitúa a nadie y se pone la fecha.
 *
 * `ahora` llega null mientras no se ha hidratado; ver RELOJ.
 */
function cuando(ms: number, ahora: number | null): string {
  if (ahora === null) return `el ${FECHA.format(ms)}`
  const seg = Math.round((ahora - ms) / 1000)
  // El reloj va redondeado al minuto, así que lo recién guardado puede caer unos
  // segundos "en el futuro". Sólo lo futuro de verdad lleva fecha.
  if (seg < -120) return `el ${FECHA.format(ms)}`
  if (seg < 60) return "ahora mismo"
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = diasNaturales(ms, ahora)
  if (dias <= 1) return "ayer"
  if (dias < 7) return `hace ${dias} días`
  return `el ${FECHA.format(ms)}`
}

const CHIP = "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors"
const CHIP_APAGADO = "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
const CHIP_VIOLETA = "border-violet-500/40 bg-violet-500/15 text-violet-600 dark:text-violet-300"

export function Atendido({
  captacionId,
  leadId,
  catalogos,
  yaAtendido,
  onHecho,
}: {
  captacionId?: number
  leadId?: string
  catalogos: Catalogo[]
  yaAtendido?: { en: string; por: string | null } | null
  /** Para quien pinte esto desde el navegador: `router.refresh()` no le recarga nada. */
  onHecho?: () => void
}): JSX.Element {
  const [abierta, setAbierta] = useState(false)
  const [nota, setNota] = useState("")
  const [resultado, setResultado] = useState<string | null>(null)
  const [atajo, setAtajo] = useState<number | "otra" | null>(null)
  const [otraFecha, setOtraFecha] = useState("")
  const [guardando, setGuardando] = useState(false)

  // null hasta que el componente está hidratado; ver RELOJ.
  const ahora = useSyncExternalStore<number | null>(
    RELOJ.subscribe,
    RELOJ.ahora,
    RELOJ.enServidor,
  )

  // Los resultados son catálogo editable desde /configuracion/catalogos, no una
  // lista escrita aquí: cada oficina querrá los suyos.
  const resultados = opcionesDe(catalogos, RESULTADO_CAT)

  // Sin contacto no hay nada que atender: el botón sale apagado en vez de
  // fallar al pulsarlo.
  const puede = Boolean(captacionId || leadId)

  function cerrar() {
    setAbierta(false)
    setNota("")
    setResultado(null)
    setAtajo(null)
    setOtraFecha("")
  }

  async function guardar() {
    if (guardando) return

    let recordarEn: string | null = null
    if (atajo === "otra") {
      recordarEn = desdeInputFecha(otraFecha)
      if (!recordarEn) return toast.error("Elige la fecha del recordatorio")
    } else if (typeof atajo === "number") {
      recordarEn = dentroDe(atajo)
    }

    setGuardando(true)
    // El .catch cubre que la acción ni llegue a contestar —red caída, despliegue
    // a mitad—: sin él la promesa se rompe, `guardando` se queda en true y el
    // botón no deja volver a intentarlo nunca.
    const r = await atender({
      captacionId,
      leadId,
      nota: nota.trim() || undefined,
      resultado,
      recordarEn,
    }).catch(() => ({ error: "No se pudo guardar" }))
    setGuardando(false)

    // Al fallar, la caja NO se cierra: lo que se acaba de escribir tras una
    // llamada es justo lo que no se puede perder, y volver a teclearlo es no
    // volver a teclearlo.
    if (r.error) return toast.error(r.error)

    toast.success(recordarEn ? "Apuntado, con recordatorio" : "Apuntado")
    cerrar()
    onHecho?.()
  }

  // Van en el contenedor y no en el textarea para que Ctrl+Enter guarde también
  // con el foco puesto en un chip o en el selector de fecha.
  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void guardar()
      return
    }
    // Escape sólo cierra si no hay nada escrito: tirar de una tecla lo que se
    // acaba de teclear es la forma más rápida de que no se vuelva a escribir.
    if (e.key === "Escape" && !nota.trim() && !guardando) {
      e.preventDefault()
      cerrar()
    }
  }

  const sello = yaAtendido ? new Date(yaAtendido.en).getTime() : null

  return (
    <div className="flex flex-col gap-2">
      {yaAtendido && sello !== null && !Number.isNaN(sello) && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
          <time dateTime={yaAtendido.en} title={FECHA_HORA.format(sello)}>
            {/* Una captación es "atendida" y un lead "atendido". Cuesta un
                ternario y esta línea se lee en voz alta al teléfono. */}
            {leadId && !captacionId ? "Atendido" : "Atendida"} {cuando(sello, ahora)}
          </time>
          {yaAtendido.por && (
            <>
              <span aria-hidden>·</span>
              <span>{yaAtendido.por}</span>
            </>
          )}
        </p>
      )}

      {!abierta ? (
        /* Cerrada no se enseña nada más: el formulario entero era el problema. */
        <button
          type="button"
          disabled={!puede}
          onClick={() => setAbierta(true)}
          className="flex h-9 items-center gap-1.5 self-start rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          <Check className="h-4 w-4" />
          {yaAtendido ? "Atender otra vez" : "Atendido"}
        </button>
      ) : (
        /* La caja sustituye al botón en vez de aparecer debajo: dejarlo ahí
           encima, ya sin nada que hacer, sólo invita a pulsarlo otra vez. */
        <div
          onKeyDown={teclas}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          {/* autoFocus: abrir la caja y tener que pulsar otra vez para escribir
              son dos clics, y el segundo ya no se da. */}
          <textarea
            autoFocus
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="¿Qué te ha dicho?"
            rows={3}
            aria-label="¿Qué te ha dicho?"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-violet-500/60"
          />

          {resultados.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {resultados.map((o) => {
                const activo = resultado === o.valor
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={activo}
                    // Selección única, y volver a pulsar lo quita: nadie tiene
                    // que acertar a la primera para poder guardar.
                    onClick={() => setResultado(activo ? null : o.valor)}
                    className={cn(CHIP, activo ? claseColor(o.color) : CHIP_APAGADO)}
                  >
                    {o.nombre}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Recordarme:</span>
            {ATAJOS.map((a) => {
              const activo = atajo === a.dias
              return (
                <button
                  key={a.dias}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setAtajo(activo ? null : a.dias)}
                  className={cn(CHIP, activo ? CHIP_VIOLETA : CHIP_APAGADO)}
                >
                  {a.etiqueta}
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={atajo === "otra"}
              onClick={() => setAtajo(atajo === "otra" ? null : "otra")}
              className={cn(CHIP, atajo === "otra" ? CHIP_VIOLETA : CHIP_APAGADO)}
            >
              otra fecha…
            </button>
            {atajo === "otra" && (
              <input
                autoFocus
                type="date"
                value={otraFecha}
                min={hoyEnMadrid()}
                onChange={(e) => setOtraFecha(e.target.value)}
                aria-label="Fecha del recordatorio"
                className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none transition-colors focus:border-violet-500/60 animate-in fade-in-0 duration-150"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="hidden flex-1 text-[11px] text-muted-foreground sm:block">
              Ctrl+Enter para guardar
            </span>
            <button
              type="button"
              onClick={cerrar}
              disabled={guardando}
              className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {guardando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
