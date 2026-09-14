import { createClient, createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import AdminDashboard, { type AdminData } from "./AdminDashboard"
import AgentDashboard from "./AgentDashboard"
import { getAgendaMes } from "@/lib/actions/agenda"
import { traerTodo } from "@/lib/supabase/paginar"

export const metadata = { title: "Inicio — mkgenia" }

const ESTADOS_LEAD = ["Nuevo", "Contactado", "Interesado", "Propuesta", "Negociacion", "Ganado", "Perdido"]

async function getAdminData(): Promise<AdminData> {
  const supabase = await createAdminClient()
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [allLeads, allCaps, demandas, usuariosRes, recientesRes, capsHistRes, leadsHistRes, interesEventos] = await Promise.all([
    traerTodo<{ id: string; estado: string; fecha_creacion: string; captado_por: string | null; fuente: string | null }>(() =>
      supabase.from("leads").select("id, estado, fecha_creacion, captado_por, fuente").order("fecha_creacion", { ascending: true })),
    traerTodo<{ id: number; activo: boolean; agente_id: string | null; estado_whatsapp: string | null }>(() =>
      supabase.from("captaciones").select("id, activo, agente_id, estado_whatsapp").order("created_at", { ascending: true })),
    traerTodo<{ id: string; estado: string; visto: boolean; fecha_creacion: string }>(() =>
      supabase.from("demandas").select("id, estado, visto, fecha_creacion").order("fecha_creacion", { ascending: true })),
    supabase.from("perfiles").select("id, nombre, apellidos, rol"),
    supabase.from("leads").select("id, nombre, apellidos, fuente, estado, fecha_creacion")
      .order("fecha_creacion", { ascending: false }).limit(6),
    supabase.from("captaciones").select("created_at").gte("created_at", hace30dias),
    supabase.from("leads").select("fecha_creacion").gte("fecha_creacion", hace30dias),
    // Cuándo se interesó cada propietario. El captador registra cada cambio de
    // estado en `historial_cambios`, así que la fecha es la de verdad y no la de
    // cuándo se le escribió.
    traerTodo<{ fecha: string; captacion_id: number }>(() =>
      supabase.from("historial_cambios")
        .select("fecha, captacion_id")
        .eq("campo", "estado_whatsapp")
        .in("valor_nuevo", ["Interesado", "Quiere_Llamada"])
        .order("fecha", { ascending: true })),
  ])

  const todosPerfiles = usuariosRes.data ?? []
  const agentes = todosPerfiles.filter((u) => u.rol !== "Admin")

  // Build last-30-days arrays (one entry per day)
  function buildHistorial(rows: Array<{ [k: string]: string | null }>, field: string) {
    const counts: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      counts[d.toISOString().slice(0, 10)] = 0
    }
    for (const row of rows) {
      const val = row[field]
      if (val) {
        const day = val.slice(0, 10)
        if (day in counts) counts[day]++
      }
    }
    return Object.entries(counts).map(([date, count]) => ({ date, count }))
  }

  const interesadosTotal = allCaps.filter((c) => ["Interesado", "Quiere_Llamada"].includes(c.estado_whatsapp ?? "")).length

  // De dónde entra cada lead. Los nombres de `fuente` los escriben workflows
  // distintos y no hay CHECK que los sujete, así que se agrupan por familias y no
  // por igualdad exacta: hoy conviven 'Captaciones', 'Web' y 'Propiedades', y
  // mañana aparecerá otro. Lo que no encaje en ninguna familia cae en "otros" en
  // vez de desaparecer de la suma.
  const FAMILIAS: Record<string, string[]> = {
    web: ["Web", "Propiedades", "Formulario", "Landing"],
    scraper: ["Captaciones", "Captacion", "Captación"],
    rrss: ["Instagram", "Facebook", "RRSS", "Redes"],
    qr: ["QR", "Galeria QR", "Trasteros WhatsApp"],
  }
  const conocidas = Object.values(FAMILIAS).flat()
  const otros = allLeads.filter((l) => !conocidas.includes(l.fuente ?? "")).length


  // Los cuatro periodos se calculan de una pasada aquí y viajan juntos al
  // cliente. Cuesta lo mismo que calcular uno —las filas ya están cargadas para
  // el pipeline— y a cambio cambiar de "hoy" a "30 días" es instantáneo, sin
  // consulta ni spinner.
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0)
  const LIMITES = {
    hoy: hoy0.toISOString(),
    semana: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    mes: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  }
  // Catorce días, uno por barra. Va en la tarjeta y es lo que convierte un
  // número suelto en algo que se puede leer: 42 no dice nada, 42 después de
  // catorce días planos sí.
  const DIAS_SERIE = 14
  const serieDe = (filas: Array<{ fecha_creacion?: string | null }>) => {
    const cubos: Record<string, number> = {}
    for (let i = DIAS_SERIE - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      cubos[d.toISOString().slice(0, 10)] = 0
    }
    for (const f of filas) {
      const dia = (f.fecha_creacion ?? "").slice(0, 10)
      if (dia in cubos) cubos[dia]++
    }
    return Object.values(cubos)
  }

  const porPeriodo = (filas: Array<{ fecha_creacion?: string | null }>) => ({
    hoy: filas.filter((f) => (f.fecha_creacion ?? "") >= LIMITES.hoy).length,
    semana: filas.filter((f) => (f.fecha_creacion ?? "") >= LIMITES.semana).length,
    mes: filas.filter((f) => (f.fecha_creacion ?? "") >= LIMITES.mes).length,
    total: filas.length,
    serie: serieDe(filas),
  })
  const familia = (fam: string) =>
    porPeriodo(allLeads.filter((l) => FAMILIAS[fam].includes(l.fuente ?? "")))

  return {
    origenes: {
      web: familia("web"),
      // El scraper NO cuenta envios, cuenta interesados.
      //
      // Contaba un lead por cada WhatsApp que salia: 880 "leads del scraper"
      // que en realidad eran 880 mensajes enviados a propietarios que en su
      // mayoria no contestaron. Al lado de 145 de Instagram parecia que el
      // captador era el canal que mas trae, y es al reves.
      //
      // Los periodos y las barras salen de CUANDO se interesaron (el historial
      // guarda la fecha del cambio de estado). El total es cuantos lo estan
      // AHORA, que es lo que enseña el resto del CRM: los que dijeron que si y
      // luego se cayeron no deben seguir sumando.
      scraper: {
        ...porPeriodo(interesEventos.map((e) => ({ fecha_creacion: e.fecha }))),
        total: interesadosTotal,
      },
      rrss: familia("rrss"),
      qr: familia("qr"),
      otros,
    },
    demandas: {
      ...porPeriodo(demandas),
      sinVer: demandas.filter((d) => d.visto === false).length,
      cualificadas: demandas.filter((d) => d.estado === "Cualificado" || d.estado === "cualificado").length,
    },
    leads: allLeads.length,
    leadsEsteMes: allLeads.filter((l) => l.fecha_creacion >= inicioMes).length,
    captaciones: allCaps.length,
    captacionesActivas: allCaps.filter((c) => c.activo).length,
    usuarios: todosPerfiles.length,
    interesadosTotal,
    tasaGlobal: allCaps.length > 0
      ? Math.round((interesadosTotal / allCaps.length) * 100) : 0,
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
    historialCaptaciones: buildHistorial(capsHistRes.data ?? [], "created_at"),
    historialLeads: buildHistorial(leadsHistRes.data ?? [], "fecha_creacion"),
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
  const isAdmin = perfil?.rol === "Admin"

  const agenda = await getAgendaMes()

  if (isAdmin) {
    const data = await getAdminData()
    return (
      <AdminDashboard
        nombre={perfil!.nombre}
        saludo={saludo}
        data={data}
        agendaEquipo={agenda}
        yoId={user.id}
      />
    )
  }

  const data = await getAgentData(user.id)
  return (
    <AgentDashboard
      nombre={perfil?.nombre ?? "—"}
      data={data}
      agendaEquipo={agenda}
      yoId={user.id}
    />
  )
}
