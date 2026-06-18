"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { invitarUsuario } from "@/lib/actions/usuarios"
import { toast } from "sonner"
import { Loader2, UserPlus } from "lucide-react"

export function InvitarUsuarioDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rol, setRol] = useState("Agente")

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set("rol", rol)

    const res = await invitarUsuario(formData)
    setLoading(false)

    if (res.error) {
      toast.error("Error al invitar", { description: res.error })
    } else {
      toast.success("Invitación enviada", {
        description: "El usuario recibirá un email para establecer su contraseña.",
      })
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm"><UserPlus className="h-4 w-4 mr-2" />Invitar usuario</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar nuevo usuario</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" name="nombre" placeholder="Ana" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apellidos">Apellidos</Label>
              <Input id="apellidos" name="apellidos" placeholder="García" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="ana@empresa.com" required />
          </div>

          <div className="space-y-1.5">
            <Label>Rol</Label>
            <Select value={rol} onValueChange={(v) => { if (v) setRol(v) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Agente">Agente</SelectItem>
                <SelectItem value="Admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enviar invitación
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
