"use client"

import { useState } from "react"
import { Home, Trash2, RotateCcw, Loader2, CheckSquare, Square, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { restaurarCaptaciones, eliminarDefinitivamente } from "@/lib/actions/captaciones"
import { WA_CLASIFICACIONES, ESTADO_COLORS } from "@/types/captaciones"

type Cap = {
  id: number
  calle: string | null
  barrio: string | null
  precio: number | null
  metros: number | null
  habitaciones: number | null
  imagen_url: string | null
  imagenes: string[] | null
  estado_crm: string | null
  estado_whatsapp: string | null
  created_at: string
}

function fmt(n: number | null) {
  if (!n) return "—"
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k €` : `${n} €`
}

interface Props {
  initialData: Cap[]
  isAdmin?: boolean
}

export function PapeleraList({ initialData, isAdmin = true }: Props) {
  const [data, setData] = useState(initialData)
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState<"restaurar" | "eliminar" | null>(null)
  const [confirmEliminar, setConfirmEliminar] = useState(false)

  const todosSeleccionados = data.length > 0 && data.every((c) => seleccionados.has(c.id))

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleTodos() {
    setSeleccionados(todosSeleccionados ? new Set() : new Set(data.map((c) => c.id)))
  }

  async function handleRestaurar() {
    if (!seleccionados.size) return
    setLoading("restaurar")
    const ids = Array.from(seleccionados)
    const res = await restaurarCaptaciones(ids)
    setLoading(null)
    if (res.error) { toast.error(res.error); return }
    setData((d) => d.filter((c) => !seleccionados.has(c.id)))
    setSeleccionados(new Set())
    toast.success(`${ids.length} captaciones restauradas`)
  }

  async function handleEliminarDefinitivamente() {
    if (!seleccionados.size) return
    setLoading("eliminar")
    const ids = Array.from(seleccionados)
    const res = await eliminarDefinitivamente(ids)
    setLoading(null)
    setConfirmEliminar(false)
    if (res.error) { toast.error(res.error); return }
    setData((d) => d.filter((c) => !seleccionados.has(c.id)))
    setSeleccionados(new Set())
    toast.success(`${ids.length} captaciones eliminadas definitivamente`)
  }

  if (data.length === 0) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">
        <Trash2 className="h-8 w-8 mx-auto mb-3 opacity-20" />
        La papelera está vacía
      </div>
    )
  }

  return (
    <>
      {/* Barra de acciones */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={toggleTodos} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {todosSeleccionados
            ? <CheckSquare className="h-3.5 w-3.5 text-violet-500" />
            : <Square className="h-3.5 w-3.5" />
          }
          {todosSeleccionados ? "Deseleccionar todo" : "Seleccionar todo"}
        </button>

        <span className="text-xs text-muted-foreground">{data.length} en papelera</span>

        {seleccionados.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{seleccionados.size} seleccionadas</span>

            <button
              onClick={handleRestaurar}
              disabled={!!loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-50"
            >
              {loading === "restaurar" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Restaurar
            </button>

            {isAdmin && (
              <button
                onClick={() => setConfirmEliminar(true)}
                disabled={!!loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar definitivamente
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div
          className="grid items-center gap-4 px-5 py-2.5 border-b border-border bg-muted/30 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
          style={{ gridTemplateColumns: "1.5rem 3.5rem 1fr 7rem 7rem 8rem" }}
        >
          <div />
          <div />
          <div>Propiedad</div>
          <div className="text-right">Precio</div>
          <div className="text-center">WhatsApp</div>
          <div className="text-center">Estado CRM</div>
        </div>

        {data.map((cap) => {
          const sel = seleccionados.has(cap.id)
          const waCls = cap.estado_whatsapp ? WA_CLASIFICACIONES[cap.estado_whatsapp] : null
          const crmStyle = cap.estado_crm ? (ESTADO_COLORS[cap.estado_crm] ?? null) : null

          return (
            <div
              key={cap.id}
              className={cn(
                "group grid items-center gap-4 px-5 py-3 border-b border-border/60 last:border-0 transition-colors",
                sel ? "bg-red-500/5" : "hover:bg-muted/20"
              )}
              style={{ gridTemplateColumns: "1.5rem 3.5rem 1fr 7rem 7rem 8rem" }}
            >
              {/* Checkbox */}
              <button onClick={() => toggleSeleccion(cap.id)} className="flex items-center justify-center">
                {sel
                  ? <CheckSquare className="h-4 w-4 text-red-500" />
                  : <Square className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                }
              </button>

              {/* Imagen */}
              <div className="h-11 w-14 rounded-lg overflow-hidden bg-muted shrink-0 opacity-60">
                {cap.imagenes?.[0] || cap.imagen_url ? (
                  <img src={cap.imagenes?.[0] ?? cap.imagen_url!} alt="" className="h-full w-full object-cover grayscale" referrerPolicy="no-referrer" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Home className="h-4 w-4 text-muted-foreground/20" />
                  </div>
                )}
              </div>

              {/* Dirección */}
              <div className="min-w-0 opacity-70">
                <p className="text-sm font-medium text-foreground truncate">{cap.calle ?? "Sin dirección"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {[cap.barrio, cap.metros && `${cap.metros} m²`, cap.habitaciones && `${cap.habitaciones} hab.`].filter(Boolean).join(" · ")}
                </p>
              </div>

              {/* Precio */}
              <div className="text-right opacity-70">
                <p className="text-sm font-semibold text-foreground">{fmt(cap.precio)}</p>
              </div>

              {/* WA */}
              <div className="flex justify-center">
                {waCls ? (
                  <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full", waCls.bg, waCls.text)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", waCls.dot)} />
                    {waCls.label}
                  </span>
                ) : <span className="text-[10px] text-muted-foreground/40">—</span>}
              </div>

              {/* Estado CRM */}
              <div className="flex justify-center">
                {crmStyle && cap.estado_crm ? (
                  <span className={cn("text-[10px] font-semibold px-2.5 py-0.5 rounded-full", crmStyle.bg, crmStyle.text)}>
                    {cap.estado_crm}
                  </span>
                ) : <span className="text-[10px] text-muted-foreground/40">—</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal confirmación eliminación definitiva */}
      {confirmEliminar && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmEliminar(false)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-background border border-border rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-semibold">Eliminar definitivamente</p>
                <p className="text-xs text-muted-foreground mt-0.5">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Se eliminarán <span className="font-semibold text-foreground">{seleccionados.size} captaciones</span> junto con todas sus fotos del storage, historial de cambios y datos asociados.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmEliminar(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminarDefinitivamente}
                disabled={loading === "eliminar"}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loading === "eliminar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
