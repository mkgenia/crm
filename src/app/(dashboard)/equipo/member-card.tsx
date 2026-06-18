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

  async function togglePermiso(key: keyof Permisos) {
    const next = { ...permisos, [key]: !permisos[key] }
    setPermisos(next)
    const res = await actualizarPermisos(member.id, next)
    if (res.error) { setPermisos(permisos); toast.error("Error al actualizar permisos") }
  }

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
              {expanded ? "Ocultar permisos" : "Gestionar permisos"}
              <div className="ml-auto flex gap-1">
                {MODULOS.map((m) => (
                  <span
                    key={m.key}
                    className={cn("text-[10px] px-1.5 py-0.5 rounded", permisos[m.key] ? "bg-violet-500/15 text-violet-400" : "bg-muted text-muted-foreground/40 line-through")}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </button>
            {expanded && (
              <div className="border-t border-border bg-muted/20 px-5 py-4 grid grid-cols-2 gap-3">
                {MODULOS.map((m) => (
                  <div key={m.key} className="flex items-center justify-between gap-3 bg-card rounded-md px-3 py-2.5 border border-border">
                    <div>
                      <p className="text-sm font-medium">{m.label}</p>
                      <p className="text-xs text-muted-foreground leading-tight">{m.descripcion}</p>
                    </div>
                    <Switch checked={permisos[m.key]} onCheckedChange={() => togglePermiso(m.key)} className="shrink-0" />
                  </div>
                ))}
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
