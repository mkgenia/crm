"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { invitarUsuario } from "@/lib/actions/usuarios"
import type { UsuarioInmovilla } from "@/lib/actions/inmovilla"
import { toast } from "sonner"
import { Loader2, UserPlus } from "lucide-react"

/** El valor del desplegable cuando no se enlaza con nadie. Un Select no puede
 *  llevar "" como valor sin quedarse en un estado raro, así que se nombra. */
const SIN_CUENTA = "ninguna"

export function InvitarUsuarioDialog({ usuariosInmovilla = [] }: { usuariosInmovilla?: UsuarioInmovilla[] }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rol, setRol] = useState("Agente")
  /**
   * Con qué cuenta de Inmovilla se corresponde quien entra.
   *
   * Se pregunta AQUÍ, al darle de alta, y no en una pantalla aparte: es el
   * momento en que alguien sabe la respuesta. Sin ella, los prospectos que esta
   * persona capte subirían a Inmovilla sin dueño.
   */
  const [cuenta, setCuenta] = useState(SIN_CUENTA)

  /** El nombre que se enseña en el desplegable cerrado. Base UI pinta el VALOR
   *  si no se le dice otra cosa, y el valor aquí es un número. */
  const etiquetaCuenta = (v: string) => {
    if (v === SIN_CUENTA) return "Sin cuenta"
    const u = usuariosInmovilla.find((x) => String(x.id) === v)
    return u ? ([u.nombre, u.apellidos].filter(Boolean).join(" ") || u.usuario || `Código ${u.id}`) : v
  }


  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set("rol", rol)
    formData.set("inmovilla_agente_id", cuenta === SIN_CUENTA ? "" : cuenta)

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

          {/* Sólo si hay cuentas que ofrecer. Con la lista vacía, un
              desplegable con una única opción llamada "Sin cuenta" es ruido. */}
          {usuariosInmovilla.length > 0 && (
            <div className="space-y-1.5">
              <Label>Cuenta de Inmovilla</Label>
              <Select value={cuenta} onValueChange={(v) => { if (v) setCuenta(v) }}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => etiquetaCuenta(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CUENTA}>Sin cuenta</SelectItem>
                  {usuariosInmovilla
                    .filter((u) => !u.desactivado)
                    .map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {[u.nombre, u.apellidos].filter(Boolean).join(" ") || u.usuario || `Código ${u.id}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
