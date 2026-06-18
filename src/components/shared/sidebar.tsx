"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Home,
  UserCircle,
  MessageSquare,
  Building2,
  Settings,
  LogOut,
  UsersRound,
  Inbox,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Permisos } from "@/types/database"

const NAV_ITEMS = [
  { href: "/dashboard",   icon: Home,          label: "Inicio",      permiso: "all" },
  { href: "/captaciones", icon: Building2,     label: "Captaciones", permiso: "captaciones" as keyof Permisos },
  { href: "/leads",       icon: UserCircle,    label: "Leads",       permiso: "leads" as keyof Permisos },
  { href: "/mensajes",    icon: MessageSquare, label: "Mensajes",    permiso: "mensajes" as keyof Permisos },
  { href: "/demandas",    icon: Inbox,         label: "Demandas",    permiso: "all" },
  { href: "/equipo",      icon: UsersRound,    label: "Equipo",      permiso: "admin" },
]

interface SidebarProps {
  rol: string
  permisos: Permisos
  nombre: string
  avatar_url?: string | null
}

export function Sidebar({ rol, permisos, nombre }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = rol === "Admin"
  const [alertasWA, setAlertasWA] = useState(0)
  const [nuevasCaptaciones, setNuevasCaptaciones] = useState(0)
  const [nuevasDemandas, setNuevasDemandas] = useState(0)

  // Realtime badge: respuestas WA + detección de nuevas asignaciones (solo agentes)
  useEffect(() => {
    const supabase = createClient()
    let uid: string | null = null

    const fetchCount = async () => {
      if (!uid) return
      let query = supabase
        .from("captaciones")
        .select("id", { count: "exact", head: true })
        .in("estado_whatsapp", ["Interesado", "Quiere_Llamada"])
        .eq("activo", true)

      if (!isAdmin) query = query.eq("agente_id", uid)

      const { count } = await query
      setAlertasWA(count ?? 0)
    }

    // Canal creado síncronamente → cleanup siempre tiene referencia
    const channel = supabase
      .channel("sidebar-alertas")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "captaciones" },
        async (payload) => {
          await fetchCount()

          if (!isAdmin && uid) {
            const newAgente = (payload.new as any)?.agente_id
            const oldAgente = (payload.old as any)?.agente_id
            if (newAgente === uid && oldAgente !== uid) {
              setNuevasCaptaciones((n) => n + 1)
              toast("Nueva captación asignada", {
                description: (payload.new as any).calle ?? "El admin te ha asignado una propiedad",
                action: {
                  label: "Ver",
                  onClick: () => router.push("/captaciones"),
                },
                duration: 8000,
              })
            }
          }
        }
      )
      .subscribe()

    // Auth async: obtener uid para el count inicial
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      uid = user.id
      fetchCount()
    })

    return () => { supabase.removeChannel(channel) }
  }, [isAdmin, router])

  // Badge demandas no vistas
  useEffect(() => {
    const supabase = createClient()
    const fetchDemandas = async () => {
      const { count } = await supabase
        .from("demandas")
        .select("id", { count: "exact", head: true })
        .eq("visto", false)
      setNuevasDemandas(count ?? 0)
    }
    fetchDemandas()
    const channel = supabase
      .channel("sidebar-demandas")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demandas" }, () => {
        setNuevasDemandas((n) => n + 1)
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "demandas" }, () => {
        fetchDemandas()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.permiso === "all") return true
    if (item.permiso === "admin") return isAdmin
    if (isAdmin) return true
    return permisos[item.permiso as keyof Permisos]
  })

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <aside className="w-[220px] shrink-0 bg-sidebar flex flex-col h-screen sticky top-0 border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-sidebar-border flex justify-center">
        <Image src="/logo.png" alt="mkgenia" width={110} height={28} priority />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/")
          const showBadge = href === "/captaciones" && alertasWA > 0
          const showNuevas = href === "/captaciones" && !isAdmin && nuevasCaptaciones > 0 && alertasWA === 0
          const showDemandas = href === "/demandas" && nuevasDemandas > 0

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active && "holo-icon")} />
              {label}
              {showBadge && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] font-semibold text-emerald-400 tabular-nums">
                    {alertasWA}
                  </span>
                </span>
              )}
              {showNuevas && (
                <span
                  className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 cursor-pointer"
                  onClick={() => setNuevasCaptaciones(0)}
                >
                  {nuevasCaptaciones} nueva{nuevasCaptaciones > 1 ? "s" : ""}
                </span>
              )}
              {showDemandas && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                  <span className="text-[10px] font-semibold text-violet-400 tabular-nums">
                    {nuevasDemandas}
                  </span>
                </span>
              )}
              {!showBadge && !showNuevas && !showDemandas && active && (
                <span className="ml-auto w-1 h-4 rounded-full bg-gradient-to-b from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)]" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-3 space-y-0.5">
        <Link
          href="/configuracion"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60 transition-all"
        >
          <Settings className="h-4 w-4 shrink-0" />
          Configuración
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60 transition-all"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Cerrar sesión
        </button>

        {/* User pill */}
        <div className="mt-3 flex items-center gap-3 px-3 py-2.5 rounded-md bg-sidebar-accent/40 border border-sidebar-border">
          <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
            {nombre.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{nombre}</p>
            <p className="text-xs text-sidebar-foreground/60">{rol}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
