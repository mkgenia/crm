"use client"

import Link from "next/link"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Globe, Radar, Share2, QrCode, Inbox, Heart, PhoneMissed } from "lucide-react"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import { SeccionesOrdenables, SeccionOrdenable } from "@/components/shared/secciones-ordenables"
import { claseColor, clasePunto } from "@/lib/catalogos"
import type { EntradaAgenda, PersonaAgenda } from "@/lib/agenda"

/*
 * Ni los nombres de los estados ni sus colores se escriben aquí.
 *
 * Había tres mapas —etiqueta, pastilla y una paleta de siete hex para la barra—
 * y los tres se quedaban cortos en cuanto el administrador añadía un estado
 * desde /configuracion/catalogos: la leyenda del pipeline pintaba un punto
 * transparente y un hueco donde va el nombre (le pasa hoy mismo al estado
 * `test`, el octavo). Ahora el nombre y el color llegan resueltos del servidor y
 * se pintan con `claseColor`/`clasePunto`, que son mapas fijos —Tailwind no
 * encuentra una clase construida con plantilla y la purga en producción— y caen
 * a gris ante un color desconocido.
 */

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export interface Periodos {
  hoy: number; semana: number; mes: number; total: number
  serie: number[]
}

export type ClavePeriodo = "hoy" | "semana" | "mes" | "total"

export const PERIODOS: Array<{ valor: ClavePeriodo; etiqueta: string; frase: string }> = [
  { valor: "hoy", etiqueta: "Hoy", frase: "Entrados hoy" },
  { valor: "semana", etiqueta: "7 días", frase: "En los últimos 7 días" },
  { valor: "mes", etiqueta: "30 días", frase: "En los últimos 30 días" },
  { valor: "total", etiqueta: "Todo", frase: "Desde el principio" },
]

/**
 * Barras de los últimos catorce días. SVG a mano y no una librería: son
 * catorce rectángulos, y meter recharts en una tarjeta de este tamaño cuesta
 * más de lo que aporta.
 */
function Barras({ serie, color }: { serie: number[]; color: string }) {
  const max = Math.max(...serie, 1)
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-8" aria-hidden="true">
      {serie.map((v, i) => {
        const ancho = 100 / serie.length
        const alto = v === 0 ? 1.5 : Math.max(2.5, (v / max) * 26)
        return (
          <rect
            key={i}
            x={i * ancho + ancho * 0.18}
            y={28 - alto}
            width={ancho * 0.64}
            height={alto}
            rx={1}
            className={color}
            opacity={v === 0 ? 0.18 : 0.45 + (v / max) * 0.55}
          />
        )
      })}
    </svg>
  )
}

export interface AdminData {
  origenes: {
    web: Periodos
    scraper: Periodos
    rrss: Periodos
    qr: Periodos
    otros: number
  }
  demandas: Periodos & { sinVer: number; cualificadas: number }
  leads: number
  leadsEsteMes: number
  captaciones: number
  captacionesActivas: number
  usuarios: number
  interesadosTotal: number
  tasaGlobal: number
  /**
   * La señal del captador (migración 027): quién ha dicho que sí y a cuántos de
   * ésos no les ha llamado nadie todavía.
   *
   * Cada contador puede venir a `null` por su cuenta y eso significa "esta
   * consulta falló", no "cero". Se pintan por separado justamente por eso.
   */
  senal: {
    total: number | null
    sinLlamar: number | null
    porValor: Array<{ valor: string; nombre: string; color: string | null; count: number | null }>
  }
  /** Las columnas del catálogo `estado_lead`, con su nombre y su color. */
  pipeline: Array<{ estado: string; nombre: string; color: string | null; count: number }>
  porAgente: Array<{
    id: string; nombre: string; initials: string
    captaciones: number; leads: number; interesados: number; tasa: number
  }>
  leadsRecientes: Array<{
    id: string | number; nombre: string; apellidos?: string | null
    fuente?: string | null; estado: string
    estadoNombre: string; estadoColor: string | null
    fecha_creacion?: string | null
  }>
  historialCaptaciones: Array<{ date: string; count: number }>
  historialLeads: Array<{ date: string; count: number }>
}

export default function AdminDashboard({ nombre, saludo, data, agendaEquipo, yoId }: {
  nombre: string
  saludo: string
  data: AdminData
  agendaEquipo: { entradas: EntradaAgenda[]; personas: PersonaAgenda[]; disponible: boolean }
  yoId: string
}) {
  const totalPipeline = data.pipeline.reduce((s, p) => s + p.count, 0)
  const [periodo, setPeriodo] = useState<ClavePeriodo>("hoy")

  return (
    <div className="p-8 space-y-8">

      <SeccionesOrdenables
        claveGuardado="mkgenia:orden-portada"
        encabezado={
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground">
              {saludo}, <span className="holo-text">{nombre}</span>
            </h1>
            <p className="text-sm text-muted-foreground">Vista global del equipo</p>
          </div>
        }
        acciones={
          <span className="text-xs border border-border rounded-full px-3 py-1 text-muted-foreground bg-card flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Admin
          </span>
        }
      >

      <SeccionOrdenable id="senal" titulo="Han dicho que sí">
      <SenalPanel senal={data.senal} />
      </SeccionOrdenable>

      <SeccionOrdenable id="origenes" titulo="De dónde entran los leads">
      {/* De dónde entra cada lead: es la pregunta que se hace uno al abrir el CRM,
          así que va primero y a tamaño grande. Los canales que aún no producen
          nada se pintan igual — ver el hueco es la mitad de la información. */}
      {/* El hueco lo reparte el padre con gap. Los márgenes sueltos del hijo
          —mb-4 en la cabecera, mt-0.5 bajo el título, mt-2 en la nota— decían lo
          mismo desde el sitio equivocado. Los valores son los de antes: 16 px
          entre bloques, 2 px bajo el título y 8 px antes de la nota. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-foreground">De dónde entran los leads</h2>
            <p className="text-xs text-muted-foreground">
              {PERIODOS.find((p) => p.valor === periodo)!.frase}
            </p>
          </div>

          {/* El selector no consulta nada: los cuatro periodos vienen calculados
              del servidor, así que el cambio es instantáneo. */}
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {PERIODOS.map((p) => (
              <button
                key={p.valor}
                onClick={() => setPeriodo(p.valor)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  periodo === p.valor
                    ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>

        {/* La rejilla y su nota van juntas en un grupo propio: la nota se
            despega 8 px de las tarjetas, no los 16 que separan los bloques. */}
        <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <OrigenCard
            href="/leads" icon={Globe} label="Formularios web"
            datos={data.origenes.web} periodo={periodo}
            tono="cyan"
          />
          {/* El "sin llamar" se repite aquí a propósito. El orden de la portada
              se guarda en el navegador, y a quien ya la había reordenado la
              sección nueva se le añade al final: este número no puede depender
              de que baje a buscarlo. */}
          <OrigenCard
            href="/captaciones" icon={Radar} label="Scraper · con señal"
            datos={data.origenes.scraper} periodo={periodo}
            tono="violeta"
            extra={
              data.senal.sinLlamar !== null && data.senal.sinLlamar > 0
                ? `${data.interesadosTotal.toLocaleString("es")} con señal · ${data.senal.sinLlamar} sin llamar`
                : `${data.interesadosTotal.toLocaleString("es")} con señal ahora mismo`
            }
          />
          <OrigenCard
            href="/demandas" icon={Inbox} label="Demandas"
            datos={data.demandas} periodo={periodo}
            tono="verde"
            extra={data.demandas.sinVer > 0 ? `${data.demandas.sinVer} sin ver` : undefined}
          />
          <OrigenCard
            href="/leads" icon={Share2} label="Redes sociales"
            datos={data.origenes.rrss} periodo={periodo}
            tono="rosa"
          />
          <OrigenCard
            href="/galeria-qr" icon={QrCode} label="Códigos QR"
            datos={data.origenes.qr} periodo={periodo}
            tono="ambar"
          />
          <OrigenCard
            href="/matches" icon={Heart} label="Matches"
            datos={null} periodo={periodo}
            tono="granate"
          />
        </div>
        {data.origenes.otros > 0 && (
          <p className="text-[11px] text-muted-foreground/70">
            {data.origenes.otros} lead{data.origenes.otros > 1 ? "s" : ""} con un origen que no encaja en
            ninguno de estos canales.
          </p>
        )}
        </div>
      </div>

      </SeccionOrdenable>

      <SeccionOrdenable id="agenda" titulo="Agenda del equipo">
      {agendaEquipo.disponible ? (
        <AgendaPanel
          entradasIniciales={agendaEquipo.entradas}
          personas={agendaEquipo.personas}
          yoId={yoId}
          isAdmin
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-5 text-xs text-muted-foreground">
          La agenda necesita la migración <code className="text-foreground">009_agenda.sql</code>.
          En cuanto la ejecutes aparece aquí.
        </div>
      )}

      </SeccionOrdenable>

      <SeccionOrdenable id="pipeline" titulo="Pipeline de leads">
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
          Pipeline de leads · todos los agentes
        </h2>
        <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4">
          {totalPipeline > 0 && (
            <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
              {data.pipeline.map((p) =>
                p.count > 0 ? (
                  <div key={p.estado}
                    style={{ width: `${(p.count / totalPipeline) * 100}%` }}
                    className={cn("rounded-sm", clasePunto(p.color))}
                    title={`${p.nombre}: ${p.count}`}
                  />
                ) : null
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {data.pipeline.map((p) => (
              <div key={p.estado} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full shrink-0", clasePunto(p.color))} />
                <span className="text-xs text-muted-foreground">{p.nombre}</span>
                <span className="text-xs font-medium text-foreground tabular-nums">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      </SeccionOrdenable>

      <SeccionOrdenable id="agentes" titulo="Rendimiento y actividad">
      {/* Rendimiento por agente + Historial side by side */}
      <AgentesYHistorial porAgente={data.porAgente} historialCaptaciones={data.historialCaptaciones} historialLeads={data.historialLeads} />

      </SeccionOrdenable>

      <SeccionOrdenable id="ultimos" titulo="Últimos leads">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
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
                <span className={cn("text-xs px-2 py-0.5 rounded border font-medium", claseColor(lead.estadoColor))}>
                  {lead.estadoNombre}
                </span>
                <span className="text-xs text-muted-foreground/60 shrink-0 hidden sm:block w-8 text-right">
                  {lead.fecha_creacion ? timeAgo(lead.fecha_creacion) : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      </SeccionOrdenable>

      </SeccionesOrdenables>
    </div>
  )
}

/**
 * Quién ha levantado la mano y todavía no ha sonado su teléfono.
 *
 * Con la migración 027 el interés dejó de ser un estado de WhatsApp y pasó a la
 * columna `senal`. La portada seguía contando "interesados" en cuatro sitios y
 * ninguno respondía a la única pregunta que cuesta dinero: de los que han dicho
 * que sí, ¿a cuántos no ha llamado nadie? `atendido_en` a nulo no es un olvido
 * de alguien —lo escribe sola la base al registrar cualquier interacción, 021—:
 * es que ese teléfono no ha sonado nunca.
 */
function SenalPanel({ senal }: { senal: AdminData["senal"] }) {
  // Un contador que ha fallado vale null y NO se pinta. Un cero enorme aquí se
  // leería como "no queda nadie esperando", que es exactamente lo contrario de
  // lo que significa una consulta que no ha respondido.
  const sinLlamar = senal.sinLlamar
  const urge = sinLlamar !== null && sinLlamar > 0

  return (
    // El hueco entre el título y la tarjeta lo pone el padre con gap, no el
    // hijo con un margen suelto.
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
        Han dicho que sí
      </h2>

      <Link
        href="/captaciones"
        className={cn(
          "rounded-lg border bg-card px-5 py-5 flex items-center justify-between gap-6 flex-wrap transition-colors",
          urge ? "border-rose-500/40 hover:bg-rose-500/[0.04]" : "border-border hover:bg-muted/20",
        )}
      >
        <div className="flex items-center gap-4 min-w-0">
          <span className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
            urge ? "bg-rose-500/15 text-rose-500" : "bg-emerald-500/15 text-emerald-500",
          )}>
            <PhoneMissed className="h-5 w-5" />
          </span>

          <div className="flex items-baseline gap-3 flex-wrap min-w-0">
            {sinLlamar === null ? (
              // Se dice que no se ha podido contar. Inventarse un cero sería
              // peor que no enseñar nada.
              <span className="text-sm text-muted-foreground">
                No se ha podido contar a quién falta por llamar
              </span>
            ) : (
              <>
                <span className={cn(
                  "text-[2.6rem] font-bold tabular-nums leading-[0.85] tracking-tight",
                  urge ? "text-rose-500" : "text-muted-foreground/35",
                )}>
                  {sinLlamar.toLocaleString("es")}
                </span>
                <span className="text-sm text-muted-foreground">
                  {urge ? "esperando a que alguien les llame" : "nadie esperando una llamada"}
                  {senal.total !== null && ` · ${senal.total.toLocaleString("es")} con señal en total`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* El desglose por señal, con el nombre y el color tal y como estén en
            /configuracion/catalogos. Una señal nueva aparece aquí sola. */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {senal.porValor.map((v) => (
            <span
              key={v.valor}
              className={cn(
                "text-xs px-2.5 py-1 rounded border font-medium flex items-center gap-2",
                claseColor(v.color),
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", clasePunto(v.color))} />
              {v.nombre}
              {/* Sin número si la consulta de ESE valor falló. La pastilla sigue
                  diciendo que la señal existe, que ya es algo. */}
              {v.count !== null && <span className="tabular-nums">{v.count.toLocaleString("es")}</span>}
            </span>
          ))}
        </div>
      </Link>
    </div>
  )
}

/**
 * Tarjeta de canal. Un canal que todavía no produce nada se pinta igual pero
 * apagado y con la etiqueta: saber que RRSS está a cero es tan útil como saber que
 * el scraper trae 838, y esconderlo daría la impresión de que no existe.
 */
/**
 * Cada canal con su tono completo: el icono metido en una pastilla de color, el
 * borde con presencia y un lavado muy suave de fondo. Un borde al 25 % y un
 * número fino no sostienen una tarjeta de este tamaño — se quedan flotando.
 */
const TONOS = {
  cyan:    { chip: "bg-cyan-500/15 text-cyan-500",       borde: "border-cyan-500/40",    wash: "from-cyan-500/[0.08]",    barra: "fill-cyan-500" },
  violeta: { chip: "bg-violet-500/15 text-violet-500",   borde: "border-violet-500/40",  wash: "from-violet-500/[0.08]",  barra: "fill-violet-500" },
  verde:   { chip: "bg-emerald-500/15 text-emerald-500", borde: "border-emerald-500/40", wash: "from-emerald-500/[0.08]", barra: "fill-emerald-500" },
  rosa:    { chip: "bg-pink-500/15 text-pink-500",       borde: "border-pink-500/40",    wash: "from-pink-500/[0.08]",    barra: "fill-pink-500" },
  ambar:   { chip: "bg-amber-500/15 text-amber-500",     borde: "border-amber-500/40",   wash: "from-amber-500/[0.08]",   barra: "fill-amber-500" },
  granate: { chip: "bg-rose-500/15 text-rose-500",       borde: "border-rose-500/40",    wash: "from-rose-500/[0.08]",    barra: "fill-rose-500" },
} as const

function OrigenCard({ href, icon: Icon, label, datos, periodo, tono, extra }: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  datos: Periodos | null
  periodo: ClavePeriodo
  tono: keyof typeof TONOS
  extra?: string
}) {
  // `datos` a null significa "esta sección todavía no existe", que no es lo
  // mismo que un canal montado y a cero. Se distinguen a propósito.
  const enDesarrollo = datos === null
  const valor = datos ? datos[periodo] : 0
  const sinUsar = !enDesarrollo && datos!.total === 0
  const apagado = enDesarrollo || sinUsar
  const t = TONOS[tono]

  return (
    <Link
      href={href}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card px-4 py-4 flex flex-col gap-3 transition-all",
        apagado ? "border-border hover:border-border" : `${t.borde} hover:bg-muted/20`,
      )}
    >
      {/* Lavado de color muy tenue: da cuerpo a la tarjeta sin gritar. */}
      {!apagado && (
        <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none", t.wash)} />
      )}

      <div className="relative flex items-center gap-2.5">
        <span className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          apagado ? "bg-muted text-muted-foreground/50" : t.chip,
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-medium text-foreground/90 truncate">{label}</span>
      </div>

      {enDesarrollo ? (
        <p className="relative text-xs text-muted-foreground/50 leading-snug pb-1">En desarrollo</p>
      ) : (
        // El número a la izquierda y los catorce días a la derecha: la tarjeta
        // es ancha, y dejar ese hueco vacío es lo que la hacía parecer pobre.
        <div className="relative flex items-end justify-between gap-4">
          <div className="shrink-0 flex flex-col gap-2">
            <p className={cn(
              "text-[2.6rem] font-bold tabular-nums leading-[0.85] tracking-tight",
              valor === 0 ? "text-muted-foreground/35" : "text-foreground",
            )}>
              {valor}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {extra ?? (sinUsar
                ? "Aún sin usar"
                : periodo === "total"
                  ? "desde el principio"
                  : `${datos!.total.toLocaleString("es")} en total`)}
            </p>
          </div>

          <div className="flex-1 min-w-0 max-w-[13rem] flex flex-col items-end gap-1">
            <Barras serie={datos!.serie} color={t.barra} />
            <span className="text-[10px] text-muted-foreground/50">últimos 14 días</span>
          </div>
        </div>
      )}
    </Link>
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
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
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

  const fmt = (iso: unknown) => { if (typeof iso !== "string") return ""; const [, m, d] = iso.split("-"); return `${d}/${m}` }

  const BTNS: { id: Serie; label: string; color: string }[] = [
    { id: "captaciones", label: "Captaciones", color: "#7F77DD" },
    { id: "leads",       label: "Leads",       color: "#1D9E75" },
    { id: "ambos",       label: "Ambos",       color: "#888780" },
  ]

  // thead(36) + 3×fila(61=60+1px divider) = 219px content + 2px border top/bottom tabla = 221px
  const CARD_H = 221

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
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
                // Sin anotar los parámetros: recharts los tipa por contexto y
                // así no hace falta un `any` que el lint rechaza.
                formatter={(value, name) => [
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
