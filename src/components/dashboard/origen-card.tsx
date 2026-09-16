"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * LA TARJETA DE CANAL DE LAS DOS PORTADAS.
 *
 * Vivía dentro de `AdminDashboard.tsx` y ahora la pinta también el agente, así
 * que se saca aquí con lo que necesita para funcionar: los tonos, las barras y
 * el tipo de los periodos. La del administrador NO cambia: las mismas clases,
 * los mismos textos y los mismos datos que antes. Todo lo que entra por el
 * agente —un contador suelto en vez de los cuatro periodos, y el estado de
 * fallo— llega por parámetros OPCIONALES que el administrador no pasa, así que
 * su rama de render es la de siempre, línea por línea.
 */

export interface Periodos {
  hoy: number; semana: number; mes: number; total: number
  serie: number[]
}

export type ClavePeriodo = "hoy" | "semana" | "mes" | "total"

export const PERIODOS: Array<{ valor: ClavePeriodo; etiqueta: string; frase: string }> = [
  { valor: "hoy", etiqueta: "Hoy", frase: "Entrados hoy" },
  { valor: "semana", etiqueta: "7 días", frase: "En los últimos 7 días" },
  { valor: "mes", etiqueta: "30 días", frase: "En los últimos 30 días" },
  { valor: "total", etiqueta: "Todo", frase: "Desde el principio" },
]

/**
 * Barras de los últimos catorce días. SVG a mano y no una librería: son
 * catorce rectángulos, y meter recharts en una tarjeta de este tamaño cuesta
 * más de lo que aporta.
 */
function Barras({ serie, color }: { serie: number[]; color: string }) {
  const max = Math.max(...serie, 1)
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-8" aria-hidden="true">
      {serie.map((v, i) => {
        const ancho = 100 / serie.length
        const alto = v === 0 ? 1.5 : Math.max(2.5, (v / max) * 26)
        return (
          <rect
            key={i}
            x={i * ancho + ancho * 0.18}
            y={28 - alto}
            width={ancho * 0.64}
            height={alto}
            rx={1}
            className={color}
            opacity={v === 0 ? 0.18 : 0.45 + (v / max) * 0.55}
          />
        )
      })}
    </svg>
  )
}

/**
 * Tarjeta de canal. Un canal que todavía no produce nada se pinta igual pero
 * apagado y con la etiqueta: saber que RRSS está a cero es tan útil como saber que
 * el scraper trae 838, y esconderlo daría la impresión de que no existe.
 */
/**
 * Cada canal con su tono completo: el icono metido en una pastilla de color, el
 * borde con presencia y un lavado muy suave de fondo. Un borde al 25 % y un
 * número fino no sostienen una tarjeta de este tamaño — se quedan flotando.
 */
export const TONOS = {
  cyan:    { chip: "bg-cyan-500/15 text-cyan-500",       borde: "border-cyan-500/40",    wash: "from-cyan-500/[0.08]",    barra: "fill-cyan-500" },
  violeta: { chip: "bg-violet-500/15 text-violet-500",   borde: "border-violet-500/40",  wash: "from-violet-500/[0.08]",  barra: "fill-violet-500" },
  verde:   { chip: "bg-emerald-500/15 text-emerald-500", borde: "border-emerald-500/40", wash: "from-emerald-500/[0.08]", barra: "fill-emerald-500" },
  rosa:    { chip: "bg-pink-500/15 text-pink-500",       borde: "border-pink-500/40",    wash: "from-pink-500/[0.08]",    barra: "fill-pink-500" },
  ambar:   { chip: "bg-amber-500/15 text-amber-500",     borde: "border-amber-500/40",   wash: "from-amber-500/[0.08]",   barra: "fill-amber-500" },
  granate: { chip: "bg-rose-500/15 text-rose-500",       borde: "border-rose-500/40",    wash: "from-rose-500/[0.08]",    barra: "fill-rose-500" },
} as const

export function OrigenCard({ href, icon: Icon, label, datos, periodo = "total", tono, extra, fallo }: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  /**
   * TRES FORMAS Y TRES SIGNIFICADOS, que con `fallo` son los cuatro estados que
   * esta pantalla no puede confundir nunca:
   *
   *   · `Periodos` → los cuatro periodos y las barras de catorce días. Es lo que
   *     manda el administrador, que tiene el selector arriba.
   *   · `number` → UN contador y ya: ni periodo ni barras. Es lo que manda el
   *     agente, cuyos números son de dos cifras y a quien catorce barras casi
   *     planas sólo le dirían que no trabaja.
   *   · `null` → esta sección todavía no existe ("En desarrollo"), que NO es lo
   *     mismo que un canal montado y a cero. Se distinguen a propósito.
   *
   * Y un canal a cero tampoco es uno que no se ha podido contar: para eso está
   * `fallo`, que manda sobre `datos` y pinta el aviso en ámbar. Un cero se lee
   * como "no tienes ninguno" y eso sería mentir.
   */
  datos: Periodos | number | null
  /** Sólo lo usa quien manda `Periodos`. Sin selector, el periodo es el total. */
  periodo?: ClavePeriodo
  tono: keyof typeof TONOS
  extra?: string
  fallo?: boolean
}) {
  const enDesarrollo = datos === null
  const unico = typeof datos === "number"
  const valor = enDesarrollo ? 0 : unico ? datos : datos[periodo]
  const total = enDesarrollo ? 0 : unico ? datos : datos.total
  // Sin serie no hay barras: el contador suelto del agente no la trae.
  const serie = enDesarrollo || unico ? null : datos.serie
  const sinUsar = !enDesarrollo && total === 0
  const apagado = Boolean(fallo) || enDesarrollo || sinUsar
  const t = TONOS[tono]

  return (
    <Link
      href={href}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card px-4 py-4 flex flex-col gap-3 transition-all",
        // El ámbar es el color con el que estas dos portadas cuentan los fallos.
        fallo ? "border-amber-500/30 hover:bg-muted/20"
          : apagado ? "border-border hover:border-border"
          : `${t.borde} hover:bg-muted/20`,
      )}
    >
      {/* Lavado de color muy tenue: da cuerpo a la tarjeta sin gritar. */}
      {!apagado && (
        <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none", t.wash)} />
      )}

      <div className="relative flex items-center gap-2.5">
        <span className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          fallo ? "bg-amber-500/10 text-amber-500"
            : apagado ? "bg-muted text-muted-foreground/50"
            : t.chip,
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-medium text-foreground/90 truncate">{label}</span>
      </div>

      {fallo ? (
        // Un fallo no enseña número. Ni siquiera un "—" en gris, que en esta
        // rejilla se leería igual que un cero apagado.
        <p className="relative text-xs text-amber-500/80 leading-snug pb-1">No se ha podido contar</p>
      ) : enDesarrollo ? (
        <p className="relative text-xs text-muted-foreground/50 leading-snug pb-1">En desarrollo</p>
      ) : (
        // El número a la izquierda y los catorce días a la derecha: la tarjeta
        // es ancha, y dejar ese hueco vacío es lo que la hacía parecer pobre.
        <div className="relative flex items-end justify-between gap-4">
          <div className="shrink-0 flex flex-col gap-2">
            <p className={cn(
              "text-[2.6rem] font-bold tabular-nums leading-[0.85] tracking-tight",
              valor === 0 ? "text-muted-foreground/35" : "text-foreground",
            )}>
              {valor}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {extra ?? (sinUsar
                ? "Aún sin usar"
                : unico || periodo === "total"
                  ? "desde el principio"
                  : `${total.toLocaleString("es")} en total`)}
            </p>
          </div>

          {serie && (
            <div className="flex-1 min-w-0 max-w-[13rem] flex flex-col items-end gap-1">
              <Barras serie={serie} color={t.barra} />
              <span className="text-[10px] text-muted-foreground/50">últimos 14 días</span>
            </div>
          )}
        </div>
      )}
    </Link>
  )
}
