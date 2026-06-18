import { createClient, createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import AdminDashboard, { type AdminData } from "./AdminDashboard"
import AgentDashboard from "./AgentDashboard"

export const metadata = { title: "Inicio — mkgenia" }

const ESTADOS_LEAD = ["Nuevo", "Contactado", "Interesado", "Propuesta", "Negociacion", "Ganado", "Perdido"]

async function getAdminData(): Promise<AdminData> {
  const supabase = await createAdminClient()
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [leadsRes, capsRes, usuariosRes, recientesRes] = await Promise.all([
    supabase.from("leads").select("id, estado, fecha_creacion, captado_por", { count: "exact" }),
    supabase.from("captaciones").select("id, activo, agente_id, estado_whatsapp", { count: "exact" }),
    supabase.from("perfiles").select("id, nombre, apellidos, rol"),
    supabase.from("leads").select("id, nombre, apellidos, fuente, estado, fecha_creacion")
      .order("fecha_creacion", { ascending: false }).limit(6),
  ])

  const allLeads = leadsRes.data ?? []
  const allCaps = capsRes.data ?? []
  const todosPerfiles = usuariosRes.data ?? []
  const agentes = todosPerfiles.filter((u) => u.rol !== "Admin")

  const interesadosTotal = allCaps.filter((c) => ["Interesado", "Quiere_Llamada"].includes(c.estado_whatsapp ?? "")).length

  return {
    leads: leadsRes.count ?? 0,
    leadsEsteMes: allLeads.filter((l) => l.fecha_creacion >= inicioMes).length,
    captaciones: capsRes.count ?? 0,
    captacionesActivas: allCaps.filter((c) => c.activo).length,
    usuarios: todosPerfiles.length,
    interesadosTotal,
    tasaGlobal: (capsRes.count ?? 0) > 0
      ? Math.round((interesadosTotal / (capsRes.count ?? 1)) * 100) : 0,
    pipeline: ESTADOS_LEAD.map((e) => ({ estado: e, count: allLeads.filter((l) => l.estado === e).length })),
    porAgente: agentes.map((a) => {
      const misCaps = allCaps.filter((c) => c.agente_id === a.id)
      const interesados = misCaps.filter((c) => ["Interesado", "Quiere_Llamada"].includes(c.estado_whatsapp ?? "")).length
      return {
        id: a.id,
        nombre: `${a.nombre} ${a.apellidos ?? ""}`.trim(),
        initials: a.nombre.charAt(0).toUpperCase() + (a.apellidos?.charAt(0).toUpperCase() ?? ""),
        captaciones: misCaps.length,
        leads: allLeads.filter((l) => l.captado_por === a.id).length,
        interesados,
        tasa: misCaps.length > 0 ? Math.round((interesados / misCaps.length) * 100) : 0,
      }
    }).sort((a, b) => b.leads - a.leads),
    leadsRecientes: recientesRes.data ?? [],
  }
}

async function getAgentData(userId: string) {
  const supabase = await createAdminClient()
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const hoy = new Date().toISOString()

  const [capsRes, agendaRes] = await Promise.all([
    supabase.from("captaciones")
      .select("id, estado_whatsapp, activo, created_at")
      .eq("agente_id", userId),
    supabase.from("captaciones")
      .select("id, nombre, telefono, direccion, estado_whatsapp, fecha_agenda, notas_agenda")
      .eq("agente_id", userId)
      .eq("estado_agenda", "pendiente")
      .gte("fecha_agenda", hoy)
      .order("fecha_agenda", { ascending: true })
      .limit(5),
  ])

  const caps = capsRes.data ?? []
  const capIds = caps.map((c) => c.id)

  const leadsFilter = capIds.length > 0
    ? `captado_por.eq.${userId},captacion_id.in.(${capIds.join(",")})`
    : `captado_por.eq.${userId}`

  const [allLeadsRes, recientesRes] = await Promise.all([
    supabase.from("leads").select("id, estado").or(leadsFilter),
    supabase.from("leads").select("id, nombre, apellidos, fuente, estado, fecha_creacion")
      .or(leadsFilter).order("fecha_creacion", { ascending: false }).limit(6),
  ])

  const allLeads = allLeadsRes.data ?? []

  const wa = {
    Interesado:     caps.filter((c) => c.estado_whatsapp === "Interesado").length,
    Quiere_Llamada: caps.filter((c) => c.estado_whatsapp === "Quiere_Llamada").length,
    Respondido:     caps.filter((c) => c.estado_whatsapp === "Respondido").length,
    No_Interesado:  caps.filter((c) => c.estado_whatsapp === "No_Interesado").length,
    Enviado:        caps.filter((c) => c.estado_whatsapp === "Enviado").length,
    Pendiente:      caps.filter((c) => !c.estado_whatsapp || c.estado_whatsapp === "Pendiente").length,
  }

  return {
    captaciones: caps.length,
    captacionesEsteMes: caps.filter((c) => c.created_at && c.created_at >= inicioMes).length,
    captacionesActivas: caps.filter((c) => c.activo).length,
    leadsTotal: allLeads.length,
    leadsRecientes: recientesRes.data ?? [],
    wa,
    interesadosTotal: wa.Interesado + wa.Quiere_Llamada,
    tasaRespuesta: caps.length > 0
      ? Math.round(((caps.length - wa.Pendiente - wa.Enviado) / caps.length) * 100) : 0,
    pipeline: ESTADOS_LEAD.map((e) => ({ estado: e, count: allLeads.filter((l) => l.estado === e).length })),
    agenda: agendaRes.data ?? [],
  }
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles").select("nombre, rol").eq("id", user.id).single()

  const hora = new Date().getHours()
  const saludo = hora < 13 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches"

  if (perfil?.rol === "Admin") {
    const data = await getAdminData()
    return <AdminDashboard nombre={perfil.nombre} saludo={saludo} data={data} />
  }

  const data = await getAgentData(user.id)
  return <AgentDashboard nombre={perfil?.nombre ?? "—"} data={data} />
}
