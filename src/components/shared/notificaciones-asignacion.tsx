"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { getCaptacionesSinVer, marcarCaptacionesVistas } from "@/lib/actions/captaciones"

interface Props {
  userId: string
}

export function NotificacionesAsignacion({ userId }: Props) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const mostrarToasts = (captaciones: { id: number; calle: string | null; barrio: string | null }[]) => {
      if (!captaciones.length) return
      const ids = captaciones.map((c) => c.id)
      marcarCaptacionesVistas(ids)

      if (captaciones.length === 1) {
        toast("Nueva captación asignada", {
          description: captaciones[0].calle ?? captaciones[0].barrio ?? "El admin te ha asignado una propiedad",
          action: { label: "Ver", onClick: () => router.push("/captaciones") },
          duration: 8000,
        })
      } else {
        toast(`${captaciones.length} captaciones asignadas`, {
          description: "El admin te ha asignado nuevas propiedades",
          action: { label: "Ver", onClick: () => router.push("/captaciones") },
          duration: 8000,
        })
      }
    }

    // Canal creado síncronamente → cleanup siempre tiene referencia
    const channel = supabase
      .channel("asignaciones-agente")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "captaciones" },
        async (payload) => {
          const newAgente = (payload.new as any)?.agente_id
          const oldAgente = (payload.old as any)?.agente_id
          if (newAgente === userId && oldAgente !== userId) {
            const cap = payload.new as any
            mostrarToasts([{ id: cap.id, calle: cap.calle, barrio: cap.barrio }])
          }
        }
      )
      .subscribe()

    // Notificaciones offline: captaciones sin ver al montar
    getCaptacionesSinVer(userId).then(mostrarToasts)

    return () => { supabase.removeChannel(channel) }
  }, [userId, router])

  return null
}
