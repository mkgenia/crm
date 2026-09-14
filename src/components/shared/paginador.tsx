"use client"

import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * El control de páginas de las listas largas.
 *
 * Existe porque las tres listas del CRM se estaban cortando en silencio: leads
 * enseñaba 500 de 1.042, captaciones 500 de 1.031 y demandas 1.000 de 1.825.
 * Ninguna decía nada — sencillamente faltaban filas.
 *
 * Enseña siempre el rango y el total ("51–100 de 1.042") y no sólo las flechas.
 * Sin el total no hay forma de saber si lo que ves es todo, que es exactamente
 * el problema que veníamos arrastrando.
 */
export function Paginador({
  pagina,
  porPagina,
  total,
  onCambiar,
  cargando = false,
  className,
}: {
  /** Empieza en 1. */
  pagina: number
  porPagina: number
  /** Total real de filas, contado en la base de datos. */
  total: number
  onCambiar: (pagina: number) => void
  cargando?: boolean
  className?: string
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)

  // Con una sola página no se pinta nada: un paginador que no pagina es ruido.
  if (total <= porPagina) return null

  return (
    <div className={cn("flex items-center justify-between gap-3 px-1 py-2", className)}>
      <p className="text-xs text-muted-foreground tabular-nums">
        {desde.toLocaleString("es")}–{hasta.toLocaleString("es")}
        <span className="text-muted-foreground/60"> de </span>
        {total.toLocaleString("es")}
      </p>

      <div className="flex items-center gap-1.5">
        {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

        <button
          onClick={() => onCambiar(pagina - 1)}
          disabled={pagina <= 1 || cargando}
          className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <span className="text-xs text-muted-foreground tabular-nums px-1 min-w-[4.5rem] text-center">
          {pagina} de {paginas}
        </span>

        <button
          onClick={() => onCambiar(pagina + 1)}
          disabled={pagina >= paginas || cargando}
          className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Lo que enseña cada página. 50 cabe en pantalla sin scroll infinito. */
export const POR_PAGINA = 50
