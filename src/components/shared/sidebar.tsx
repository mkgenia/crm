"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Sun,
  Radar,
  RefreshCw,
  Share2,
  QrCode,
  LayoutTemplate,
  CalendarDays,
  UserCircle,
  Contact,
  Building2,
  Target,
  Inbox,
  Heart,
  MessageSquare,
  Calculator,
  Bot,
  Workflow,
  UsersRound, Tags,
  Settings,
  LogOut,
  ChevronRight,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Permisos } from "@/types/database"

/**
 * El menú va agrupado por lo que el negocio hace, no por lo que el CRM tiene
 * montado: primero de dónde salen los leads, luego el trabajo inmobiliario, y por
 * último las tuercas. Varias entradas apuntan todavía a páginas en desarrollo; se
 * dejan a la vista a propósito, para que el mapa completo se entienda desde el
 * primer día en vez de ir apareciendo a trozos.
 */
type Item = {
  href: string
  icon: typeof Sun
  label: string
  permiso: "all" | "admin" | keyof Permisos
  enDesarrollo?: boolean
}

/** Ocultar el enlace no protege la página: la puerta real está en
 *  `exigirModulo()`, dentro de cada page.tsx. Esto sólo evita enseñar a un
 *  agente una sección a la que no va a poder entrar. */

const GRUPOS: Array<{ titulo: string | null; items: Item[] }> = [
  {
    titulo: null,
    items: [
      { href: "/dashboard", icon: Sun, label: "Mi día", permiso: "all" },
    ],
  },
  {
    titulo: "Generador de leads",
    items: [
      { href: "/captaciones", icon: Radar, label: "Scraper", permiso: "captaciones" },
      { href: "/reactivacion", icon: RefreshCw, label: "Reactivación", permiso: "reactivacion", enDesarrollo: true },
      { href: "/galeria-rrss", icon: Share2, label: "Galería RRSS", permiso: "galeria_rrss", enDesarrollo: true },
      { href: "/galeria-qr", icon: QrCode, label: "Galería QR", permiso: "galeria_qr", enDesarrollo: true },
      { href: "/landings", icon: LayoutTemplate, label: "Landings", permiso: "landings", enDesarrollo: true },
    ],
  },
  {
    titulo: "Inmobiliaria",
    items: [
      { href: "/leads", icon: UserCircle, label: "Leads", permiso: "leads" },
      // Contactos es a donde va a ir Leads cuando exista: la ficha única de cada
      // persona. Conviven a propósito — la atenuada es la que viene, la otra es
      // donde se trabaja hoy.
      { href: "/contactos", icon: Contact, label: "Contactos", permiso: "leads", enDesarrollo: true },
      { href: "/propiedades", icon: Building2, label: "Propiedades", permiso: "propiedades", enDesarrollo: true },
      { href: "/prospectos", icon: Target, label: "Prospectos", permiso: "prospectos", enDesarrollo: true },
      { href: "/demandas", icon: Inbox, label: "Demandas", permiso: "demandas" },
      { href: "/matches", icon: Heart, label: "Matches", permiso: "matches", enDesarrollo: true },
      { href: "/mensajes", icon: MessageSquare, label: "Mensajes", permiso: "mensajes" },
      { href: "/valorador", icon: Calculator, label: "Valorador", permiso: "valorador" },
    ],
  },
  {
    titulo: "Automatización & IA",
    items: [
      { href: "/agentes-ia", icon: Bot, label: "Agentes IA", permiso: "admin", enDesarrollo: true },
      { href: "/workflows", icon: Workflow, label: "Workflows", permiso: "admin", enDesarrollo: true },
    ],
  },
  // Las dos secciones que van de personas y de tiempo, no de negocio. El
  // calendario lo ve todo el mundo: la agenda de uno mismo no es algo que tenga
  // sentido conceder o denegar. Equipo sigue siendo sólo de administración.
  {
    titulo: "Organización",
    items: [
      { href: "/calendario", icon: CalendarDays, label: "Calendario", permiso: "all" },
      { href: "/configuracion/catalogos", icon: Tags, label: "Catálogos", permiso: "catalogos" },
      { href: "/equipo", icon: UsersRound, label: "Equipo", permiso: "admin" },
    ],
  },
]

interface SidebarProps {
  rol: string
  permisos: Permisos
  nombre: string
  avatar_url?: string | null
}

const CLAVE_PLEGADOS = "mkgenia:menu-plegado"

export function Sidebar({ rol, permisos, nombre }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = rol === "Admin"
  // Los contadores nacen en null y vuelven a null si la consulta falla: un 0 se
  // lee como "no hay ninguna", y ahí es donde el agente deja de mirar.
  const [alertasWA, setAlertasWA] = useState<number | null>(null)
  const [nuevasCaptaciones, setNuevasCaptaciones] = useState(0)
  const [nuevasDemandas, setNuevasDemandas] = useState<number | null>(null)
  const [plegados, setPlegados] = useState<Record<string, boolean>>({})
  const [sombra, setSombra] = useState({ arriba: false, abajo: false })
  const navRef = useRef<HTMLElement>(null)

  // Se restaura en un efecto y no en el estado inicial: localStorage no existe
  // en el servidor, y devolver un menú distinto al del HTML rompe la hidratación.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_PLEGADOS)
      if (guardado) setPlegados(JSON.parse(guardado) as Record<string, boolean>)
    } catch {
      /* modo incógnito o storage lleno: el menú se abre entero y ya está */
    }
  }, [])

  function plegar(titulo: string) {
    setPlegados((prev) => {
      const siguiente = { ...prev, [titulo]: !prev[titulo] }
      try { localStorage.setItem(CLAVE_PLEGADOS, JSON.stringify(siguiente)) } catch { /* idem */ }
      return siguiente
    })
  }

  // Los degradados de arriba y abajo sólo se pintan cuando hay algo escondido
  // por ese lado. Un velo permanente sobre el primer o el último enlace los
  // apagaría sin motivo en las pantallas donde el menú cabe entero.
  const medirSombras = useCallback(() => {
    const el = navRef.current
    if (!el) return
    setSombra({
      arriba: el.scrollTop > 4,
      abajo: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    })
  }, [])

  useEffect(() => {
    const el = navRef.current
    if (!el) return
    medirSombras()
    const ro = new ResizeObserver(medirSombras)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [medirSombras, plegados])

  // Realtime badge: captaciones con señal + detección de nuevas asignaciones (solo agentes)
  useEffect(() => {
    const supabase = createClient()
    let uid: string | null = null

    const fetchCount = async () => {
      if (!uid) return
      // Se cuenta por `senal`, no por estado: desde la migración 027 "le
      // interesa" y "quiere llamada" ya no son estados de WhatsApp —los dos se
      // fundieron en Respondido— y lo que la IA entiende vive en su columna.
      // Buscar aquí los estados viejos devolvería 0 para siempre.
      let query = supabase
        .from("captaciones")
        .select("id", { count: "exact", head: true })
        .not("senal", "is", null)
        .eq("activo", true)

      if (!isAdmin) query = query.eq("agente_id", uid)

      // El count se pide a la base con head:true y sin traer filas: contar sobre
      // lo cargado miente en cuanto se pasa de 1.000, que es donde PostgREST
      // corta en silencio.
      const { count, error } = await query
      // Un fallo de red no puede apagar la chapa diciendo "no hay ninguna":
      // vuelve a null y la chapa simplemente no se pinta hasta el próximo aviso.
      setAlertasWA(error ? null : count)
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
            const newAgente = (payload.new as { agente_id?: string })?.agente_id
            const oldAgente = (payload.old as { agente_id?: string })?.agente_id
            if (newAgente === uid && oldAgente !== uid) {
              setNuevasCaptaciones((n) => n + 1)
              toast("Nueva captación asignada", {
                description: (payload.new as { calle?: string }).calle ?? "El admin te ha asignado una propiedad",
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
      const { count, error } = await supabase
        .from("demandas")
        .select("id", { count: "exact", head: true })
        .eq("visto", false)
      // Mismo criterio que el de captaciones: si la cuenta falla no se pinta.
      setNuevasDemandas(error ? null : count)
    }
    fetchDemandas()
    const channel = supabase
      .channel("sidebar-demandas")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demandas" }, () => {
        // Se vuelve a contar en la base en vez de sumar uno a lo que hubiera:
        // la demanda nueva puede entrar ya vista, y si la cuenta de partida
        // falló (null) sumarle uno la inventaría.
        void fetchDemandas()
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "demandas" }, () => {
        fetchDemandas()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const puedeVer = (item: Item) => {
    if (item.permiso === "all") return true
    if (item.permiso === "admin") return isAdmin
    if (isAdmin) return true
    return permisos[item.permiso as keyof Permisos]
  }

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
      <div className="relative flex-1 min-h-0">
        <nav
          ref={navRef}
          onScroll={medirSombras}
          className="h-full px-3 py-4 overflow-y-auto overscroll-contain scrollbar-nav"
        >
        <div>
        {GRUPOS.map((grupo, gi) => {
          const items = grupo.items.filter(puedeVer)
          if (!items.length) return null

          const abierto = !grupo.titulo || !plegados[grupo.titulo]
          const contieneActivo = items.some(
            (i) => pathname === i.href || pathname.startsWith(i.href + "/")
          )
          // Un contador sin leer (null) no suma: cuenta como lo que es, un dato
          // que no se tiene, no como un cero.
          const pendientes = items.reduce((n, i) => {
            if (i.href === "/captaciones") return n + (alertasWA ?? 0)
            if (i.href === "/demandas") return n + (nuevasDemandas ?? 0)
            return n
          }, 0)

          return (
            <div key={grupo.titulo ?? "inicio"} className={cn(gi > 0 && "mt-4")}>
              {grupo.titulo && (
                <button
                  onClick={() => plegar(grupo.titulo!)}
                  aria-expanded={abierto}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/40 transition-colors"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform duration-200",
                      abierto && "rotate-90"
                    )}
                  />
                  <span className="truncate">{grupo.titulo}</span>

                  {/* Plegado, el grupo tiene que seguir contando lo que pasa
                      dentro: si no, cerrar "Generador de leads" apagaría el
                      aviso de las captaciones con señal sin que nadie lo
                      decida. */}
                  {!abierto && pendientes > 0 && (
                    <span className="ml-auto text-[10px] font-semibold text-emerald-400 tabular-nums">
                      {pendientes}
                    </span>
                  )}
                  {!abierto && pendientes === 0 && contieneActivo && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gradient-to-br from-[oklch(0.65_0.22_295)] to-[oklch(0.80_0.15_200)]" />
                  )}
                </button>
              )}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-out",
                  abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
              <div className="overflow-hidden">
              {/* inert y no aria-hidden: un grupo plegado no puede seguir
                  recibiendo el foco con el tabulador. */}
              <div className="space-y-0.5 pt-0.5" inert={!abierto}>
                {items.map(({ href, icon: Icon, label, enDesarrollo }) => {
                  const active = pathname === href || pathname.startsWith(href + "/")
                  // `?? 0` y no `!`: mientras el contador no se haya leído (o su
                  // consulta haya fallado) la chapa no se pinta.
                  const showBadge = href === "/captaciones" && (alertasWA ?? 0) > 0
                  const showNuevas = href === "/captaciones" && !isAdmin && nuevasCaptaciones > 0 && !alertasWA
                  const showDemandas = href === "/demandas" && (nuevasDemandas ?? 0) > 0

                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60",
                        enDesarrollo && !active && "text-sidebar-foreground/45",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active && "holo-icon")} />
                      <span className="truncate">{label}</span>

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
                      {/* Un punto, no la palabra: en un menú de quince entradas el texto
                          "en desarrollo" repetido nueve veces se come la lectura. */}
                      {enDesarrollo && !showBadge && !showNuevas && !showDemandas && (
                        <span
                          className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-foreground/30 shrink-0"
                          title="En desarrollo"
                        />
                      )}
                      {!enDesarrollo && !showBadge && !showNuevas && !showDemandas && active && (
                        <span className="ml-auto w-1 h-4 rounded-full bg-gradient-to-b from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)]" />
                      )}
                    </Link>
                  )
                })}
              </div>
              </div>
              </div>
            </div>
          )
        })}
        </div>
        </nav>

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-sidebar to-transparent transition-opacity duration-200",
            sombra.arriba ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-sidebar to-transparent transition-opacity duration-200",
            sombra.abajo ? "opacity-100" : "opacity-0"
          )}
        />
      </div>

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
