"use client"

import { useState } from "react"
import { Settings, X, Plus, Trash2, Loader2, Check, MapPin, Zap, ZapOff, Globe } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toggleAutoContacto, agregarZona, toggleZona, eliminarZona } from "@/lib/actions/captaciones-config"

interface Zona {
  id: string
  url: string
  nombre: string
  activa: boolean
}

interface Props {
  enabled: boolean
  zonas: Zona[]
}

export function CaptacionesConfig({ enabled: initialEnabled, zonas: initialZonas }: Props) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [zonas, setZonas] = useState(initialZonas)
  const [toggling, setToggling] = useState(false)
  const [nuevaUrl, setNuevaUrl] = useState("")
  const [nuevaNombre, setNuevaNombre] = useState("")
  const [addingZona, setAddingZona] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [loadingZona, setLoadingZona] = useState<string | null>(null)

  async function handleToggle() {
    setToggling(true)
    const next = !enabled
    setEnabled(next)
    await toggleAutoContacto(next)
    setToggling(false)
    toast.success(next ? "Auto-contacto activado" : "Auto-contacto desactivado")
  }

  async function handleAddZona() {
    if (!nuevaUrl.trim() || !nuevaNombre.trim()) return
    setAddingZona(true)
    const res = await agregarZona(nuevaUrl, nuevaNombre)
    setAddingZona(false)
    if (res.error) { toast.error(res.error); return }
    setZonas((z) => [...z, { id: crypto.randomUUID(), url: nuevaUrl, nombre: nuevaNombre, activa: false }])
    setNuevaUrl("")
    setNuevaNombre("")
    setShowAddForm(false)
    toast.success("Zona añadida")
  }

  async function handleToggleZona(id: string, activa: boolean) {
    setLoadingZona(id)
    await toggleZona(id, activa)
    setZonas((z) => z.map((zona) => ({ ...zona, activa: zona.id === id ? activa : activa ? false : zona.activa })))
    setLoadingZona(null)
  }

  async function handleEliminarZona(id: string) {
    if (!confirm("¿Eliminar esta zona?")) return
    setLoadingZona(id)
    await eliminarZona(id)
    setZonas((z) => z.filter((zona) => zona.id !== id))
    setLoadingZona(null)
    toast.success("Zona eliminada")
  }

  return (
    <>
      {/* Botón disparador */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-colors"
      >
        <Settings className="h-4 w-4" />
        Configuración
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      {/* Panel lateral */}
      <div className={cn(
        "fixed right-0 top-0 h-full w-full max-w-sm z-50 bg-background border-l border-border flex flex-col shadow-2xl transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Configuración del captador</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Auto-contacto toggle */}
          <section className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Auto-contacto WhatsApp</p>
              <p className="text-xs text-muted-foreground mt-0.5">Cuando se detecta una captación nueva, se envía automáticamente un mensaje al propietario.</p>
            </div>

            <button
              onClick={handleToggle}
              disabled={toggling}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all",
                enabled
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                  : "bg-muted/40 border-border text-muted-foreground hover:border-border/80"
              )}
            >
              <div className="flex items-center gap-3">
                {toggling
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : enabled
                  ? <Zap className="h-5 w-5" />
                  : <ZapOff className="h-5 w-5" />
                }
                <div className="text-left">
                  <p className="text-sm font-semibold">{enabled ? "Activado" : "Desactivado"}</p>
                  <p className="text-xs opacity-70">{enabled ? "Enviando mensajes automáticamente" : "Sin envío automático"}</p>
                </div>
              </div>
              {/* Toggle visual */}
              <div className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                enabled ? "bg-emerald-500" : "bg-border"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  enabled ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
          </section>

          {/* Zonas de scraping */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Zonas de scraping</p>
                <p className="text-xs text-muted-foreground mt-0.5">Solo una zona puede estar activa a la vez.</p>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 font-medium"
              >
                <Plus className="h-3.5 w-3.5" /> Añadir
              </button>
            </div>

            {/* Formulario añadir zona */}
            {showAddForm && (
              <div className="rounded-lg border border-dashed border-violet-500/40 p-3 space-y-2 bg-violet-500/5">
                <input
                  value={nuevaNombre}
                  onChange={(e) => setNuevaNombre(e.target.value)}
                  placeholder="Nombre de la zona (ej. Barcelona Centro)"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  value={nuevaUrl}
                  onChange={(e) => setNuevaUrl(e.target.value)}
                  placeholder="URL de Idealista"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowAddForm(false); setNuevaUrl(""); setNuevaNombre("") }}
                    className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAddZona}
                    disabled={addingZona || !nuevaUrl.trim() || !nuevaNombre.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-violet-500 hover:bg-violet-600 text-white font-medium disabled:opacity-40 transition-colors"
                  >
                    {addingZona ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Guardar zona
                  </button>
                </div>
              </div>
            )}

            {/* Lista de zonas */}
            <div className="space-y-2">
              {zonas.length === 0 && (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  <Globe className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  No hay zonas configuradas
                </div>
              )}
              {zonas.map((zona) => (
                <div
                  key={zona.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                    zona.activa ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/20"
                  )}
                >
                  <MapPin className={cn("h-4 w-4 mt-0.5 shrink-0", zona.activa ? "text-emerald-500" : "text-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", zona.activa ? "text-foreground" : "text-muted-foreground")}>
                      {zona.nombre}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{zona.url}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {loadingZona === zona.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <button
                          onClick={() => handleToggleZona(zona.id, !zona.activa)}
                          className={cn(
                            "text-xs px-2 py-1 rounded-md font-medium transition-colors",
                            zona.activa
                              ? "bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30"
                              : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                          )}
                        >
                          {zona.activa ? "Activa" : "Activar"}
                        </button>
                        <button
                          onClick={() => handleEliminarZona(zona.id)}
                          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Info técnica */}
          <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Información técnica</p>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>Webhook respuestas WA:</p>
              <code className="block bg-background border border-border rounded px-2 py-1 text-[10px] break-all">
                {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhook/captacion-respuesta
              </code>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
