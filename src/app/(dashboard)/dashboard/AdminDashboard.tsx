import Link from "next/link"
import { Users, Building2, UserCircle, TrendingUp } from "lucide-react"

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

      <div>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest mb-4">
          Rendimiento por agente
        </h2>
        {data.porAgente.length === 0 ? (
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
            {data.porAgente.map((a) => (
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
          </div>
        )}
      </div>

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
