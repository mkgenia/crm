"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { CheckCircle, Clock, Building2, UserCircle, MoreHorizontal, Shield, Trash2, ChevronDown } from "lucide-react"
import { actualizarPermisos, actualizarRol, eliminarUsuario } from "@/lib/actions/usuarios"
import { toast } from "sonner"
import { MODULOS, type Permisos } from "@/types/database"
import { cn } from "@/lib/utils"

interface Member {
  id: string
  nombre: string
  apellidos: string | null
  rol: string
  telefono: string | null
  usuario: string | null
  created_at: string
  permisos: Permisos
  captaciones_total: number
  captaciones_pendientes: number
  captaciones_completadas: number
  leads_total: number
}

function Stat({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number; color: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground ml-auto">{value}</span>
    </div>
  )
}

export function MemberCard({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const isAdmin = member.rol === "Admin"
  const [permisos, setPermisos] = useState<Permisos>(member.permisos)
  const [expanded, setExpanded] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const initials = `${member.nombre.charAt(0)}${member.apellidos?.charAt(0) ?? ""}`.toUpperCase()
  const joined = new Date(member.created_at).toLocaleDateString("es-ES", { month: "short", year: "numeric" })

  async function aplicar(next: Permisos) {
    const previo = permisos
    setPermisos(next)
    const res = await actualizarPermisos(member.id, next)
    if (res.error) { setPermisos(previo); toast.error("Error al actualizar permisos") }
  }

  // SÓLO LO QUE EXISTE. El recuento decía "9 de 13 secciones" contando cinco
  // pantallas que todavía no se han escrito, así que ningún agente podía llegar
  // nunca al total y el número no significaba nada. Los permisos de lo que está
  // por venir se siguen pudiendo dar —se ven abajo, marcados—, pero no cuentan.
  const MODULOS_VIVOS = MODULOS.filter((m) => !m.enDesarrollo)
  const concedidos = MODULOS_VIVOS.filter((m) => permisos[m.key]).length
  const grupos = Array.from(new Set(MODULOS.map((m) => m.grupo)))

  async function handleToggleRol() {
    setShowMenu(false)
    const newRol = isAdmin ? "Agente" : "Admin"
    const res = await actualizarRol(member.id, newRol)
    if (res.error) toast.error("Error al cambiar rol")
    else toast.success(`${member.nombre} ahora es ${newRol}`)
  }

  async function handleEliminar() {
    setConfirmDelete(false)
    const res = await eliminarUsuario(member.id)
    if (res.error) toast.error("Error al eliminar usuario")
    else toast.success(`${member.nombre} eliminado`)
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 flex items-start gap-3">
          <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 text-white">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-foreground truncate">
                {member.nombre} {member.apellidos}
              </p>
              {isSelf && <span className="text-xs text-muted-foreground">(tú)</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isAdmin ? "bg-violet-500/10 text-violet-500" : "bg-muted text-muted-foreground"}`}>
                {isAdmin ? "Admin" : "Agente"}
              </span>
              <span className="text-xs text-muted-foreground">desde {joined}</span>
            </div>
            {member.telefono && (
              <p className="text-xs text-muted-foreground mt-1">{member.telefono}</p>
            )}
          </div>

          {/* Menú acciones */}
          {!isSelf && (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-8 z-50 min-w-[180px] rounded-lg border border-border bg-popover shadow-xl py-1">
                    <button
                      onClick={handleToggleRol}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      Cambiar a {isAdmin ? "Agente" : "Admin"}
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => { setShowMenu(false); setConfirmDelete(true) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar usuario
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Stats — solo agentes */}
        {!isAdmin && (
          <div className="mx-5 mb-4 rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-2">
            <Stat icon={Building2}   label="Captaciones asignadas" value={member.captaciones_total}      color="text-violet-500" />
            <Stat icon={Clock}       label="Pendientes"             value={member.captaciones_pendientes} color="text-yellow-500" />
            <Stat icon={CheckCircle} label="Completadas"            value={member.captaciones_completadas} color="text-emerald-500" />
            <Stat icon={UserCircle}  label="Leads captados"         value={member.leads_total}            color="text-cyan-500" />
          </div>
        )}

        {/* Permisos — solo agentes */}
        {!isAdmin && (
          <>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-2 px-5 py-3 border-t border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Ocultar acceso" : "Qué puede ver"}
              {/* Doce etiquetas no caben en la cabecera de la tarjeta: el
                  recuento dice lo mismo y se lee de un vistazo. */}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {concedidos} de {MODULOS_VIVOS.length} secciones
              </span>
            </button>
            {expanded && (
              <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-4">
                {grupos.map((grupo) => {
                  const mods = MODULOS.filter((m) => m.grupo === grupo)
                  const todos = mods.every((m) => permisos[m.key])
                  return (
                    <div key={grupo} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {grupo}
                        </p>
                        <button
                          onClick={() => aplicar({
                            ...permisos,
                            ...Object.fromEntries(mods.map((m) => [m.key, !todos])),
                          } as Permisos)}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {todos ? "Quitar todo" : "Dar todo"}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {mods.map((m) => (
                          <div key={m.key} className="flex items-center justify-between gap-3 bg-card rounded-md px-3 py-2.5 border border-border">
                            <div className="min-w-0">
                              <p className={cn("text-sm font-medium", m.enDesarrollo && "text-muted-foreground")}>
                                {m.label}
                                {/* Se sigue pudiendo conceder, pero se dice que
                                    todavía no lleva a ninguna parte. */}
                                {m.enDesarrollo && (
                                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">· aún no existe</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground leading-tight">{m.descripcion}</p>
                            </div>
                            <Switch
                              checked={permisos[m.key]}
                              onCheckedChange={() => aplicar({ ...permisos, [m.key]: !permisos[m.key] })}
                              className="shrink-0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  Mi día y Configuración las ve todo el mundo. Equipo, Agentes IA y
                  Workflows son sólo de administración y no se conceden.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 space-y-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-foreground">¿Eliminar a {member.nombre}?</h3>
              <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer. El usuario perderá el acceso inmediatamente.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleEliminar}
                className="h-9 px-4 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
