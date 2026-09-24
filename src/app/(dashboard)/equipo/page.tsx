import { createClient, createAdminClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/paginar"
import { redirect } from "next/navigation"
import { resolverPermisos } from "@/types/database"
import { InvitarUsuarioDialog } from "./invitar-usuario-dialog"
import { MemberCard } from "./member-card"
import { getUsuariosInmovilla } from "@/lib/actions/inmovilla"
import { SincronizarInmovilla } from "./sincronizar-inmovilla"

export const metadata = { title: "Equipo — mkgenia" }

async function getEquipo() {
  const supabase = await createAdminClient()

  const [{ data: perfiles }, captaciones, leads] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, apellidos, rol, avatar_url, telefono, usuario, permisos, created_at, inmovilla_agente_id").order("rol", { ascending: false }).order("nombre"),
    // Paginadas: con 1.031 captaciones y 1.042 leads, una consulta suelta se
    // queda en 1.000 y las estadisticas por agente salen cortas sin avisar.
    traerTodo<{ agente_id: string | null; estado_agenda: string | null }>(() =>
      supabase.from("captaciones").select("agente_id, estado_agenda").eq("activo", true).order("id", { ascending: true })),
    traerTodo<{ captado_por: string | null }>(() =>
      supabase.from("leads").select("captado_por").order("id", { ascending: true })),
  ])

  return (perfiles ?? []).map((p) => {
    const misCaptaciones = (captaciones ?? []).filter((c) => c.agente_id === p.id)
    const misLeads = (leads ?? []).filter((l) => l.captado_por === p.id)
    return {
      ...p,
      permisos: resolverPermisos(p.permisos),
      captaciones_total:       misCaptaciones.length,
      captaciones_pendientes:  misCaptaciones.filter((c) => c.estado_agenda === "pendiente").length,
      captaciones_completadas: misCaptaciones.filter((c) => c.estado_agenda === "completado").length,
      leads_total:             misLeads.length,
    }
  })
}

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase.from("perfiles").select("rol").eq("id", user.id).single()
  if (perfil?.rol !== "Admin") redirect("/dashboard")

  const equipo = await getEquipo()
  // La lista de cuentas de Inmovilla baja desde el servidor, una vez, y la
  // comparten el formulario de invitar y las fichas: su API va de uno en uno y
  // no tiene sentido llamarla cada vez que se abre un desplegable.
  const usuariosInmovilla = await getUsuariosInmovilla()
  const admins  = equipo.filter((m) => m.rol === "Admin")
  const agentes = equipo.filter((m) => m.rol !== "Admin")

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Equipo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {admins.length} administrador{admins.length !== 1 ? "es" : ""} · {agentes.length} agente{agentes.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SincronizarInmovilla />
          <InvitarUsuarioDialog usuariosInmovilla={usuariosInmovilla} />
        </div>
      </div>

      {admins.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Administradores</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {admins.map((m) => <MemberCard key={m.id} member={m as any} isSelf={m.id === user.id} usuariosInmovilla={usuariosInmovilla} />)}
          </div>
        </section>
      )}

      {agentes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Agentes</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentes.map((m) => <MemberCard key={m.id} member={m as any} isSelf={m.id === user.id} usuariosInmovilla={usuariosInmovilla} />)}
          </div>
        </section>
      )}

      {equipo.length === 0 && (
        <div className="py-20 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl">
          No hay miembros en el equipo todavía. Invita al primer agente con el botón de arriba.
        </div>
      )}
    </div>
  )
}
