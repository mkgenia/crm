"use client"

import Link from "next/link"
import { useState } from "react"
import { Users, Building2, UserCircle, TrendingUp } from "lucide-react"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts"

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

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export interface AdminData {
  leads: number
  leadsEsteMes: number
  captaciones: number
  captacionesActivas: number
  usuarios: number
  interesadosTotal: number
  tasaGlobal: number
  pipeline: Array<{ estado: string; count: number }>
  porAgente: Array<{
    id: string; nombre: string; initials: string
    captaciones: number; leads: number; interesados: number; tasa: number
  }>
  leadsRecientes: Array<{
    id: string | number; nombre: string; apellidos?: string | null
    fuente?: string | null; estado: string; fecha_creacion?: string | null
  }>
  historialCaptaciones: Array<{ date: string; count: number }>
  historialLeads: Array<{ date: string; count: number }>
}

export default function AdminDashboard({ nombre, saludo, data }: {
  nombre: string
  saludo: string
  data: AdminData
}) {
  const totalPipeline = data.pipeline.reduce((s, p) => s + p.count, 0)

  return (
    <div className="p-8 space-y-8">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {saludo}, <span className="holo-text">{nombre}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Vista global del equipo</p>
        </div>
        <span className="text-xs border border-border rounded-full px-3 py-1 text-muted-foreground bg-card flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          Admin
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard href="/leads" icon={UserCircle} label="Leads totales" value={data.leads}
          sub={`+${data.leadsEsteMes} este mes`} holo />
        <KpiCard href="/captaciones" icon={Building2} label="Captaciones" value={data.captaciones}
          sub={`${data.captacionesActivas} activas`} />
        <KpiCard href="/captaciones" icon={TrendingUp} label="Interesados" value={data.interesadosTotal}
          sub={`${data.tasaGlobal}% tasa de respuesta`} />
        <KpiCard href="/equipo" icon={Users} label="Agentes" value={data.usuarios}
          sub="en el sistema" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
          Pipeline de leads · todos los agentes
        </h2>
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          {totalPipeline > 0 && (
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
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {data.pipeline.map((p, i) => (
              <div key={p.estado} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PIPELINE_COLORS[i] }} />
                <span className="text-xs text-muted-foreground">{ESTADO_LABEL[p.estado]}</span>
                <span className="text-xs font-medium text-foreground tabular-nums">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rendimiento por agente + Historial side by side */}
      <AgentesYHistorial porAgente={data.porAgente} historialCaptaciones={data.historialCaptaciones} historialLeads={data.historialLeads} />

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">Últimos leads</h2>
          <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Ver todos
          </Link>
        </div>
        {data.leadsRecientes.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
            Aún no hay leads registrados
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

const PER_PAGE = 3

function AgentesYHistorial({ porAgente, historialCaptaciones, historialLeads }: {
  porAgente: AdminData["porAgente"]
  historialCaptaciones: AdminData["historialCaptaciones"]
  historialLeads: AdminData["historialLeads"]
}) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(porAgente.length / PER_PAGE)
  const visible = porAgente.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            Rendimiento por agente
          </h2>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{page + 1}/{totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-6 w-6 rounded border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ‹
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="h-6 w-6 rounded border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {porAgente.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
            No hay agentes registrados
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden border border-border bg-card divide-y divide-border">
            <div className="grid gap-4 px-5 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider"
              style={{ gridTemplateColumns: "1fr 72px 64px 84px 88px" }}>
              <span>Agente</span>
              <span className="text-right">Caps.</span>
              <span className="text-right">Leads</span>
              <span className="text-right">Interesados</span>
              <span className="text-right">Tasa</span>
            </div>
            {visible.map((a) => (
              <div key={a.id} className="grid gap-4 items-center px-5 py-3.5 hover:bg-muted/40 transition-colors"
                style={{ gridTemplateColumns: "1fr 72px 64px 84px 88px" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                    {a.initials}
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">{a.nombre}</span>
                </div>
                <span className="text-right text-sm tabular-nums text-foreground">{a.captaciones}</span>
                <span className="text-right text-sm tabular-nums text-foreground">{a.leads}</span>
                <span className="text-right text-sm tabular-nums">
                  {a.interesados > 0
                    ? <span className="text-emerald-500">{a.interesados}</span>
                    : <span className="text-muted-foreground">—</span>}
                </span>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs tabular-nums font-medium ${a.tasa < 10 ? "text-yellow-500" : "text-foreground"}`}>
                    {a.tasa}%
                  </span>
                  <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${a.tasa}%`, background: "linear-gradient(to right, oklch(0.65 0.22 295), oklch(0.80 0.18 145))" }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {/* Filas vacías para mantener altura fija con 3 rows */}
            {Array.from({ length: PER_PAGE - visible.length }).map((_, i) => (
              <div key={`empty-${i}`} className="px-5 py-3.5" style={{ height: 61 }} />
            ))}
          </div>
        )}
      </div>

      <HistorialChart captaciones={historialCaptaciones} leads={historialLeads} />
    </div>
  )
}

type Serie = "captaciones" | "leads" | "ambos"

function HistorialChart({
  captaciones,
  leads,
}: {
  captaciones: Array<{ date: string; count: number }>
  leads: Array<{ date: string; count: number }>
}) {
  const [serie, setSerie] = useState<Serie>("ambos")

  const showCaps  = serie === "captaciones" || serie === "ambos"
  const showLeads = serie === "leads"       || serie === "ambos"

  // Merge captaciones + leads por fecha en un array único para recharts
  const chartData = captaciones.map((c, i) => ({
    date: c.date,
    captaciones: c.count,
    leads: leads[i]?.count ?? 0,
  }))

  const totalCaps  = captaciones.reduce((s, d) => s + d.count, 0)
  const totalLeads = leads.reduce((s, d) => s + d.count, 0)

  const fmt = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}` }

  const BTNS: { id: Serie; label: string; color: string }[] = [
    { id: "captaciones", label: "Captaciones", color: "#7F77DD" },
    { id: "leads",       label: "Leads",       color: "#1D9E75" },
    { id: "ambos",       label: "Ambos",       color: "#888780" },
  ]

  // thead(36) + 3×fila(61=60+1px divider) = 219px content + 2px border top/bottom tabla = 221px
  const CARD_H = 221

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
        Actividad (30 días)
      </h2>

      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3"
        style={{ height: CARD_H }}>

        {/* Totales + botones */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex gap-4">
            {showCaps && (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#7F77DD" }} />
                <span className="text-xs text-muted-foreground">Captaciones</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: "#7F77DD" }}>{totalCaps}</span>
              </div>
            )}
            {showLeads && (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: "#1D9E75" }} />
                <span className="text-xs text-muted-foreground">Leads</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: "#1D9E75" }}>{totalLeads}</span>
              </div>
            )}
          </div>
          <div className="flex gap-1">
            {BTNS.map((b) => (
              <button
                key={b.id}
                onClick={() => setSerie(b.id)}
                className={`text-xs px-2.5 py-0.5 rounded border transition-colors ${
                  serie === b.id
                    ? "border-transparent text-white"
                    : "border-border text-muted-foreground hover:text-foreground bg-transparent"
                }`}
                style={serie === b.id ? { background: b.color } : {}}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Gráfico */}
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="rc-grad-caps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#7F77DD" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#7F77DD" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rc-grad-leads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#1D9E75" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#1D9E75" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmt}
                tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                  padding: "6px 10px",
                }}
                labelFormatter={fmt}
                formatter={(value: number, name: string) => [
                  value,
                  name === "captaciones" ? "Captaciones" : "Leads",
                ]}
              />
              {showCaps && (
                <Area
                  type="monotone"
                  dataKey="captaciones"
                  stroke="#7F77DD"
                  strokeWidth={1.5}
                  fill="url(#rc-grad-caps)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#7F77DD" }}
                />
              )}
              {showLeads && (
                <Area
                  type="monotone"
                  dataKey="leads"
                  stroke="#1D9E75"
                  strokeWidth={1.5}
                  fill="url(#rc-grad-leads)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#1D9E75" }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ href, icon: Icon, label, value, sub, holo }: {
  href?: string; icon: React.ElementType; label: string; value: number; sub: string; holo?: boolean
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
          {value.toLocaleString("es")}
        </p>
        <p className="text-xs mt-0.5 text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
  if (href) return <Link href={href}>{inner}</Link>
  return inner
}
