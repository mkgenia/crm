"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { sincronizarUsuariosInmovilla } from "@/lib/actions/inmovilla"

/**
 * Traer de Inmovilla las cuentas que todavía no conocemos.
 *
 * A mano y no automático: su API no deja pedir los usuarios en bloque —hay que
 * ir de uno en uno, con tres segundos y medio entre llamada y llamada— y la
 * lista cambia cuando entra o sale alguien, o sea, casi nunca. Se pulsa el día
 * que falte una cuenta en el desplegable.
 */
export function SincronizarInmovilla() {
  const [cargando, setCargando] = useState(false)

  async function sincronizar() {
    setCargando(true)
    const res = await sincronizarUsuariosInmovilla()
      .catch(() => ({ nuevos: 0, conocidos: 0, error: "No se ha podido hablar con Inmovilla" }))
    setCargando(false)

    if (res.error) { toast.error(res.error); return }
    toast.success(
      res.nuevos > 0
        ? `${res.nuevos} cuenta${res.nuevos === 1 ? "" : "s"} nueva${res.nuevos === 1 ? "" : "s"}`
        : "No hay cuentas nuevas",
    )
  }

  return (
    <Button size="sm" variant="ghost" onClick={sincronizar} disabled={cargando}>
      {cargando
        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        : <RefreshCw className="h-4 w-4 mr-2" />}
      Cuentas de Inmovilla
    </Button>
  )
}
