"use client"

import { useState, useRef } from "react"
import { updatePerfil } from "@/lib/actions/usuarios"

interface Props {
  nombre: string
  apellidos: string | null
  telefono: string | null
  email: string
}

export function PerfilForm({ nombre, apellidos, telefono, email }: Props) {
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const fd = new FormData(e.currentTarget)
    const result = await updatePerfil(fd)
    setSaving(false)
    if (result.error) {
      setMsg({ type: "err", text: result.error })
    } else {
      setMsg({ type: "ok", text: "Perfil actualizado correctamente" })
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="border border-border rounded-lg bg-card divide-y divide-border">
      {/* Email (read-only) */}
      <div className="flex items-center justify-between px-5 py-4 gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Email</p>
          <p className="text-xs text-muted-foreground mt-0.5">{email}</p>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded shrink-0">No editable</span>
      </div>

      {/* Nombre + Apellidos */}
      <div className="px-5 py-4 grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nombre <span className="text-red-400">*</span></label>
          <input
            name="nombre"
            required
            defaultValue={nombre}
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Apellidos</label>
          <input
            name="apellidos"
            defaultValue={apellidos ?? ""}
            className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Teléfono */}
      <div className="px-5 py-4 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Teléfono</label>
        <input
          name="telefono"
          type="tel"
          defaultValue={telefono ?? ""}
          placeholder="Ej: 612345678"
          className="w-full max-w-xs h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">Se usa como firma en mensajes WhatsApp enviados manualmente</p>
      </div>

      {/* Contraseña */}
      <div className="px-5 py-4 space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Nueva contraseña</label>
        <input
          name="password"
          type="password"
          placeholder="Dejar vacío para no cambiar"
          autoComplete="new-password"
          className="w-full max-w-xs h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Actions */}
      <div className="px-5 py-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
        {msg && (
          <p className={`text-xs ${msg.type === "ok" ? "text-emerald-500" : "text-red-400"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </form>
  )
}
