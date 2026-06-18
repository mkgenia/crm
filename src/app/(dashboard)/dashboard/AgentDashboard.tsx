"use client"

import Link from "next/link"
import { Building2, UserCircle, TrendingUp, MessageSquare, CalendarClock } from "lucide-react"

const PIPELINE_COLORS = ["#7F77DD", "#378ADD", "#1D9E75", "#EF9F27", "#D85A30", "#639922", "#888780"]
const ESTADO_LABEL: Record<string, string> = {
  Nuevo: "Nuevo", Contactado: "Contactado", Interesado: "Interesado",
  Propuesta: "Propuesta", Negociacion: "Negociación", Ganado: "Ganado", Perdido: "Perdido",
}
const ESTADO_LEAD_STYLES: Record<string, string> = {
  Nuevo:       "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20",
  Contactado:  "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border-cyan-500/20",
  Interesado:  "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/20",
  Propuesta:   "bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/20",
  Negociacion: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-300 border-yellow-500/20",
  Ganado:      "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  Perdido:     "bg-muted text-muted-foreground border-border",
}
const WA_BADGE_STYLES: Record<string, string> = {
  Interesado:     "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  Quiere_Llamada: "bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/20",
  Respondido:     "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border-cyan-500/20",
  No_Interesado:  "bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20",
  Enviado:        "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20",
  Pendiente:      "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
}
const WA_BADGE_LABELS: Record<string, string> = {
  Interesado: "Interesado", Quiere_Llamada: "Quiere llamada", Respondido: "Respondido",
  No_Interesado: "No interesado", Enviado: "Enviado", Pendiente: "Pendiente",
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function formatAgendaDate(iso: string) {
  const d = new Date(iso)
  const hoy = new Date()
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1)
  const hora = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === hoy.toDateString()) return `Hoy ${hora}`
  if (d.toDateString() === manana.toDateString()) return `Mañana ${hora}`
  return d.toLocaleDateString("es", { day: "numeric", month: "short" }) + " " + hora
}

interface AgentData {
  captaciones: number
  captacionesEsteMes: number
  captacionesActivas: number
  leadsTotal: number
  leadsRecientes: Array<{ id: string; nombre: string; apellidos: string | null; fuente: string | null; estado: string; fecha_creacion: string | null | undefined }>
  wa: { Interesado: number; Quiere_Llamada: number; Respondido: number; No_Interesado: number; Enviado: number; Pendiente: number }
  interesadosTotal: number
  tasaRespuesta: number
  pipeline: Array<{ estado: string; count: number }>
  agenda: Array<{ id: number; nombre: string | null; telefono: string | null; direccion: string | null; estado_whatsapp: string; fecha_agenda: string | null; notas_agenda: string | null }>
}

export default function AgentDashboard({ nombre, data }: { nombre: string; data: AgentData }) {
  const hora = new Date().getHours()
  const saludo = hora < 13 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches"
  const totalPipeline = data.pipeline.reduce((s, p) => s + p.count, 0)

  const WA_ITEMS = [
    { label: "Interesados",     value: data.wa.Interesado,      color: "text-emerald-500" },
    { label: "Quieren llamada", value: data.wa.Quiere_Llamada,  color: "text-orange-500" },
    { label: "Respondidos",     value: data.wa.Respondido,      color: "text-cyan-500" },
    { label: "No interesados",  value: data.wa.No_Interesado,   color: "text-red-500" },
    { label: "Enviados",        value: data.wa.Enviado,         color: "text-violet-500" },
    { label: "Pendientes",      value: data.wa.Pendiente,       color: "text-muted-foreground" },
  ]

  return (
    <div className="p-8 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {saludo},{" "}
          <span className="holo-text">{nombre}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Tu actividad personal</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          href="/captaciones"
          icon={Building2} label="Mis captaciones" value={data.captaciones}
          sub={`${data.captacionesEsteMes} este mes`} holo
        />
        <KpiCard
          href="/leads"
          icon={UserCircle} label="Mis leads" value={data.leadsTotal}
          sub="captados por ti"
        />
        <KpiCard
          href="/captaciones"
          icon={TrendingUp} label="Interesados" value={data.interesadosTotal}
          sub="interesados + quieren llamada"
        />
        <KpiCard
          icon={MessageSquare} label="Tasa respuesta" value={data.tasaRespuesta}
          sub="de tus captaciones" suffix="%"
        />
      </div>

      {/* WA stats + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
            Estado WhatsApp · mis captaciones
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {WA_ITEMS.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1">
                <span className={`text-2xl font-semibold tabular-nums ${item.color}`}>{item.value}</span>
                <span className="text-xs text-muted-foreground leading-tight">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
            Mi pipeline de leads
          </h2>
          <div className="rounded-lg border border-border bg-card p-5 space-y-4 h-[calc(100%-2.5rem)]">
            {totalPipeline > 0 ? (
              <>
                <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
                  {data.pipeline.map((p, i) =>
                    p.count > 0 ? (
                      <div key={p.estado}
                        style={{ width: `${(p.count / totalPipeline) * 100}%`, background: PIPELINE_COLORS[i] }}
                        className="rounded-sm" title={`${ESTADO_LABEL[p.estado]}: ${p.count}`}
                      />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {data.pipeline.map((p, i) => (
                    <div key={p.estado} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PIPELINE_COLORS[i] }} />
                      <span className="text-xs text-muted-foreground">{ESTADO_LABEL[p.estado]}</span>
                      <span className="text-xs font-medium text-foreground tabular-nums">{p.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-6">
                <p className="text-sm text-muted-foreground text-center">Aún no tienes leads asignados</p>
                <Link href="/leads" className="text-xs text-primary hover:underline">Ver todos los leads →</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agenda */}
      {data.agenda.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
            Agenda próxima
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
            {data.agenda.map((item) => (
              <div key={item.id} className="flex items-start gap-4 px-5 py-4 hover:bg-muted/40 transition-colors">
                <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.nombre} {item.direccion ? `· ${item.direccion}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.fecha_agenda ? formatAgendaDate(item.fecha_agenda) : "—"}
                    {item.notas_agenda ? ` · ${item.notas_agenda}` : ""}
                  </p>
                </div>
                {item.estado_whatsapp && (
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${WA_BADGE_STYLES[item.estado_whatsapp] ?? ""}`}>
                    {WA_BADGE_LABELS[item.estado_whatsapp] ?? item.estado_whatsapp}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Últimos leads */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">Mis últimos leads</h2>
          <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Ver todos
          </Link>
        </div>
        {data.leadsRecientes.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Aún no tienes leads registrados</p>
            <Link href="/leads" className="text-xs text-primary hover:underline">Crear tu primer lead →</Link>
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden border border-border divide-y divide-border bg-card">
            {data.leadsRecientes.map((lead) => (
              <div key={lead.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors">
                <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                  {lead.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{lead.nombre} {lead.apellidos}</p>
                  <p className="text-xs text-muted-foreground">{lead.fuente ?? "—"}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${ESTADO_LEAD_STYLES[lead.estado] ?? "bg-muted text-muted-foreground border-border"}`}>
                  {ESTADO_LABEL[lead.estado] ?? lead.estado}
                </span>
                <span className="text-xs text-muted-foreground/60 shrink-0 hidden sm:block w-8 text-right">
                  {lead.fecha_creacion ? timeAgo(lead.fecha_creacion) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ href, icon: Icon, label, value, sub, holo, suffix }: {
  href?: string; icon: React.ElementType; label: string; value: number; sub: string; holo?: boolean; suffix?: string
}) {
  const inner = (
    <div className={`relative rounded-lg border p-5 flex flex-col gap-3 bg-card overflow-hidden transition-all ${holo ? "holo-border holo-glow border-transparent" : "border-border"} ${href ? "hover:bg-muted/40 cursor-pointer" : ""}`}>
      {holo && (
        <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.65_0.22_295/0.06)] via-[oklch(0.80_0.15_200/0.04)] to-transparent pointer-events-none" />
      )}
      <div className="flex items-center justify-between relative">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="relative">
        <p className={`text-3xl font-semibold tracking-tight ${holo ? "holo-text" : "text-foreground"}`}>
          {value.toLocaleString("es")}{suffix ?? ""}
        </p>
        <p className="text-xs mt-0.5 text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
  if (href) return <Link href={href}>{inner}</Link>
  return inner
}
