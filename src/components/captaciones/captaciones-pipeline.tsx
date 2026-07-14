"use client"

import { useMemo, useState } from "react"
import { MapPin, GripVertical, PhoneOff } from "lucide-react"
import { ESTADOS_CAPTACION, ESTADO_LABELS, type EstadoCRM } from "@/types/captaciones"
import { actualizarEstadoCaptacion } from "@/lib/actions/captaciones"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { getCaptaciones } from "@/lib/actions/captaciones"

type Captacion = Awaited<ReturnType<typeof getCaptaciones>>[number]

// Cards visibles por columna antes de "Ver más" (evita renderizar cientos de nodos)
const PAGE_SIZE = 15

// Acento de color por columna (borde superior + punto), alineado con ESTADO_COLORS
const COLUMN_ACCENT: Record<EstadoCRM, { bar: string; dot: string; text: string }> = {
  Nuevo:       { bar: "bg-violet-500",  dot: "bg-violet-500",  text: "text-violet-500" },
  Contactado:  { bar: "bg-cyan-500",    dot: "bg-cyan-500",    text: "text-cyan-500" },
  Interesado:  { bar: "bg-blue-500",    dot: "bg-blue-500",    text: "text-blue-500" },
  Propuesta:   { bar: "bg-orange-500",  dot: "bg-orange-500",  text: "text-orange-500" },
  Negociacion: { bar: "bg-yellow-500",  dot: "bg-yellow-500",  text: "text-yellow-500" },
  Ganado:      { bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-500" },
  Perdido:     { bar: "bg-red-500",     dot: "bg-red-500",     text: "text-red-500" },
}

function fmtPrecio(n: number | null) {
  if (!n) return "0 €"
  return `${n.toLocaleString("es-ES")} €`
}

function hasPhone(tel: string | null) {
  if (!tel) return false
  const l = tel.toLowerCase()
  return !l.includes("no disponible") && !l.includes("privado") && tel.trim() !== ""
}

function normalizaEstado(estado: string | null): EstadoCRM {
  const found = ESTADOS_CAPTACION.find((e) => e === estado)
  return found ?? "Nuevo"
}

function PipelineCard({
  cap,
  onClick,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  cap: Captacion
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}) {
  const sinTel = !hasPhone(cap.telefono)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-lg border border-border bg-background p-3 transition-all hover:border-violet-500/40 hover:shadow-md hover:shadow-violet-500/5",
        dragging && "opacity-40 ring-1 ring-violet-500/40"
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-tight truncate">
            {cap.calle ?? cap.nombre ?? "Sin dirección"}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {cap.barrio && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" /> {cap.barrio}
              </span>
            )}
            {(cap.metros || cap.habitaciones) && (
              <span className="shrink-0">
                {[cap.metros && `${cap.metros}m²`, cap.habitaciones && `${cap.habitaciones}h`].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm font-semibold text-foreground">{fmtPrecio(cap.precio)}</span>
            {sinTel && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                <PhoneOff className="h-2.5 w-2.5" /> Sin tel.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  captaciones: Captacion[]
  onSelect: (id: number) => void
}

export function CaptacionesPipeline({ captaciones, onSelect }: Props) {
  // Overrides optimistas: id -> nuevo estado tras arrastrar
  const [overrides, setOverrides] = useState<Record<number, EstadoCRM>>({})
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverCol, setDragOverCol] = useState<EstadoCRM | null>(null)
  // Cuántas cards se muestran por columna (paginación incremental)
  const [limites, setLimites] = useState<Record<string, number>>({})

  const estadoDe = (cap: Captacion): EstadoCRM =>
    overrides[cap.id] ?? normalizaEstado(cap.estado_crm)

  const columnas = useMemo(() => {
    const map = ESTADOS_CAPTACION.reduce((acc, e) => {
      acc[e] = [] as Captacion[]
      return acc
    }, {} as Record<EstadoCRM, Captacion[]>)
    for (const cap of captaciones) {
      map[estadoDe(cap)].push(cap)
    }
    return map
  }, [captaciones, overrides])

  async function moverA(estado: EstadoCRM) {
    const id = dragId
    setDragId(null)
    setDragOverCol(null)
    if (id == null) return

    const cap = captaciones.find((c) => c.id === id)
    if (!cap) return
    const actual = estadoDe(cap)
    if (actual === estado) return

    // Optimista
    setOverrides((prev) => ({ ...prev, [id]: estado }))

    const res = await actualizarEstadoCaptacion(id, estado)
    if (res?.error) {
      // Revertir
      setOverrides((prev) => {
        const next = { ...prev }
        if (normalizaEstado(cap.estado_crm) === actual) delete next[id]
        else next[id] = actual
        return next
      })
      toast.error(res.error)
      return
    }
    toast.success(`Movido a "${ESTADO_LABELS[estado]}"`)
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 pt-1 scrollbar-x-visible">
      {ESTADOS_CAPTACION.map((estado) => {
        const cards = columnas[estado]
        const accent = COLUMN_ACCENT[estado]
        const suma = cards.reduce((s, c) => s + (c.precio ?? 0), 0)
        const isOver = dragOverCol === estado
        const limite = limites[estado] ?? PAGE_SIZE
        const visibles = cards.slice(0, limite)
        const restantes = cards.length - visibles.length
        return (
          <div
            key={estado}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(estado) }}
            onDragLeave={(e) => {
              // Solo limpiar si salimos realmente de la columna
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null)
            }}
            onDrop={(e) => { e.preventDefault(); moverA(estado) }}
            className={cn(
              "flex flex-col w-72 shrink-0 rounded-xl border bg-card/50 overflow-hidden transition-colors",
              isOver ? "border-violet-500/50 bg-violet-500/5" : "border-border"
            )}
          >
            {/* Barra de acento superior */}
            <div className={cn("h-0.5 w-full", accent.bar)} />

            {/* Header columna */}
            <div className="px-3 pt-3 pb-2 border-b border-border/60">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full shrink-0", accent.dot)} />
                <span className="text-sm font-medium text-foreground">{ESTADO_LABELS[estado]}</span>
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">
                  {cards.length}
                </span>
              </div>
              <p className={cn("text-xs mt-1 tabular-nums", accent.text)}>{fmtPrecio(suma)}</p>
            </div>

            {/* Cards */}
            <div className="flex-1 flex flex-col gap-2 p-2 min-h-[24rem] overflow-y-auto scrollbar-thin">
              {visibles.map((cap) => (
                <PipelineCard
                  key={cap.id}
                  cap={cap}
                  dragging={dragId === cap.id}
                  onDragStart={() => setDragId(cap.id)}
                  onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                  onClick={() => onSelect(cap.id)}
                />
              ))}
              {restantes > 0 && (
                <button
                  onClick={() => setLimites((prev) => ({ ...prev, [estado]: limite + PAGE_SIZE }))}
                  className="mt-1 w-full py-2 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
                >
                  Ver más ({restantes})
                </button>
              )}
              {cards.length === 0 && (
                <div className={cn(
                  "flex-1 flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground/50 transition-colors",
                  isOver ? "border-violet-500/40 text-violet-500/70" : "border-border/60"
                )}>
                  {isOver ? "Suelta aquí" : "Arrastra una captación aquí"}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
