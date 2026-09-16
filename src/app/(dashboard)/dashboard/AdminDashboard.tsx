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
// La tarjeta de canal, sus tonos, sus barras y el tipo de los periodos se han
// ido a `@/components/dashboard/origen-card` SIN TOCAR NADA de lo que pintan:
// la portada del agente enseña ahora las mismas seis tarjetas que ésta y el
// componente no podía seguir viviendo dentro de este fichero.
import { OrigenCard, PERIODOS, type ClavePeriodo, type Periodos } from "@/components/dashboard/origen-card"

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

export interface AdminData {
  origenes: {
    web: Periodos
    scraper: Periodos
    rrss: Periodos
    qr: Periodos
    otros: number
  }
  /**
   * Los valores de `fuente` que cuenta cada tarjeta de leads.
   *
   * No es adorno ni configuración: es lo que el enlace de esas tres tarjetas le
   * pasa a /leads (`?fuente=Instagram,Facebook,…`) para que la lista enseñe
   * exactamente las filas que se han contado. Viaja desde el servidor porque
   * allí es donde está la única lista buena (`FAMILIAS_FUENTE`); copiada aquí,
   * el día que entre una fuente nueva el número y la lista dejarían de cuadrar.
   */
  fuentes: { web: string[]; rrss: string[]; qr: string[] }
  /**
   * Dónde empieza cada periodo corto, en ISO y calculado en el servidor con el
   * mismo reloj con el que se contaron las tarjetas.
   *
   * Es la otra mitad de todos los enlaces de la rejilla: con "7 días" puesto, la
   * tarjeta dice 47 y la lista de destino tiene que enseñar esos 47. Es un dato,
   * no algo que se pinte: ningún número de la portada cambia por esto.
   */
  cortes: { hoy: string; semana: string; mes: string }
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

  /**
   * EL ENLACE DE UNA TARJETA DE LEADS: web, redes sociales y códigos QR.
   *
   * Las tres cuentan LEADS de una familia de fuentes, así que las tres llevan a
   * /leads con esa familia (`?fuente=Instagram,Facebook,…`, que la pantalla de
   * destino valida una a una contra el catálogo y pinta como chapa quitable) y,
   * si hay un periodo corto puesto, con el corte de ese periodo (`&desde=…`).
   * Sin el corte, pulsar "Redes sociales 47" con "7 días" aterrizaba en los
   * 1.090 leads de siempre: el número prometiendo una cosa y la pantalla
   * enseñando otra.
   *
   * LA DE CÓDIGOS QR LLEVABA A /galeria-qr, que es la galería de códigos —otra
   * cosa—, y por eso su número no llevaba nunca a lo que enseña: esa tarjeta
   * cuenta leads de la familia `qr`, igual que las otras dos cuentan los suyos.
   * La galería sigue en el menú, que es de donde se entra a gestionar códigos.
   *
   * El instante sale de `data.cortes`, calculado en el servidor con la MISMA
   * función y el mismo reloj con los que se contó el número. Sacarlo de
   * Date.now() aquí serían dos enlaces distintos, el que escribe el servidor y
   * el que escribe el navegador: desajuste de hidratación.
   *
   * `periodo` se manda además como palabra para que la chapa de destino se lea
   * ("Entrados hoy") en vez de enseñar una fecha con hora.
   */
  const enlaceLeads = (fuentes: string[]) => {
    const q = new URLSearchParams({ fuente: fuentes.join(",") })
    if (periodo !== "total") {
      q.set("periodo", periodo)
      q.set("desde", data.cortes[periodo])
    }
    return `/leads?${q.toString()}`
  }

  /**
   * Y EL DE LAS DEMANDAS, que no llevan fuente porque no son leads.
   *
   * /demandas es una lista de PROPIEDADES con las demandas que ha recibido cada
   * una, así que el corte le dice qué demandas mirar: con él puesto enseña sólo
   * las propiedades que han recibido alguna en ese periodo, y su cabecera dice
   * el mismo número que esta tarjeta.
   *
   * "Todo" no tiene corte: lleva a la lista entera, que es lo que dice.
   */
  const enlaceDemandas = () => {
    if (periodo === "total") return "/demandas"
    const q = new URLSearchParams({ periodo, desde: data.cortes[periodo] })
    return `/demandas?${q.toString()}`
  }

  /**
   * LA LÍNEA DE ABAJO DE ESA MISMA TARJETA.
   *
   * ARREGLADO EN REVISIÓN, y es el mismo arreglo que ya lleva la tarjeta de
   * demandas del AGENTE (`textoDemandas`, AgentDashboard.tsx). Al mandar un
   * `extra`, la tarjeta deja de escribir el suyo ("N en total"), así que con un
   * periodo corto puesto —y "Hoy" es el que trae puesto esta portada al
   * abrirse— ésta era la única de la rejilla que enseñaba un número pelado: un
   * "0" enorme bajo "Hoy" con "43 sin ver" debajo y ni rastro de las 1.825 que
   * hay. Un cero sin su total al lado se lee como avería, no como que hoy no ha
   * entrado ninguna.
   *
   * Hasta hoy ese cero al menos llevaba a la lista entera y allí se veían las
   * 1.825. Desde este cambio el enlace lleva el corte, así que lleva a una
   * pantalla vacía: el número y su destino cuadran, pero la línea de al lado
   * habla de un "sin ver" que es de TODA la vida y no del periodo, y sin el
   * total en medio esas dos cosas se leen como una sola.
   *
   * "Todo" no cambia ni una letra: ahí el número grande YA es el total, y
   * repetirlo sobraría. Y con la tabla vacía tampoco: sin `extra`, la tarjeta
   * pone su propio "Aún sin usar", que dice más.
   */
  const extraDemandas = () => {
    if (data.demandas.total === 0) return undefined
    const trozos = [
      periodo !== "total" ? `${data.demandas.total.toLocaleString("es")} en total` : null,
      data.demandas.sinVer > 0 ? `${data.demandas.sinVer.toLocaleString("es")} sin ver` : null,
    ].filter((t): t is string => t != null)
    // Sin nada que decir se devuelve `undefined` y no una cadena vacía: es lo
    // que hace que la tarjeta vuelva a escribir su propia línea en vez de
    // dejar el hueco en blanco.
    return trozos.length > 0 ? trozos.join(" · ") : undefined
  }

  /**
   * EL ENLACE DE LA TARJETA DEL SCRAPER, que va a otra pantalla y pregunta otra
   * cosa.
   *
   * Pulsar un número que dice 13 tiene que llevar a esos 13, no a las 759.
   * /captaciones necesita dos cosas para conseguirlo: el instante en que empieza
   * el periodo puesto (`desde`, calculado en el servidor con el mismo reloj con
   * el que se contó la tarjeta) y CONTRA QUÉ compararlo.
   *
   * `fecha=senal` porque ESTA tarjeta no cuenta anuncios, cuenta propietarios
   * que se interesaron, y los fecha por cuándo dijeron que sí. La del agente
   * cuenta sus captaciones asignadas por cuándo entró el anuncio y manda
   * `fecha=entrada`. Son dos listas distintas —el mismo día, 13 y 98—, así que
   * cada enlace tiene que traer la suya o el número promete una cosa y la
   * pantalla enseña otra.
   *
   * "Todo" no tiene corte: lleva a la lista entera, que es lo que dice.
   */
  const enlaceScraper = () => {
    if (periodo === "total") return "/captaciones"
    const q = new URLSearchParams({ fecha: "senal", periodo, desde: data.cortes[periodo] })
    return `/captaciones?${q.toString()}`
  }

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
          {/* Las cuatro tarjetas de abajo llevan ya su filtro: pulsar un número
              abre la lista con exactamente lo que ese número cuenta. Hasta hoy
              eran `href` fijos y aterrizaban en la lista entera. */}
          <OrigenCard
            href={enlaceLeads(data.fuentes.web)} icon={Globe} label="Formularios web"
            datos={data.origenes.web} periodo={periodo}
            tono="cyan"
          />
          {/* El "sin llamar" se repite aquí a propósito. El orden de la portada
              se guarda en el navegador, y a quien ya la había reordenado la
              sección nueva se le añade al final: este número no puede depender
              de que baje a buscarlo. */}
          <OrigenCard
            href={enlaceScraper()} icon={Radar} label="Scraper · con señal"
            datos={data.origenes.scraper} periodo={periodo}
            tono="violeta"
            extra={
              data.senal.sinLlamar !== null && data.senal.sinLlamar > 0
                ? `${data.interesadosTotal.toLocaleString("es")} con señal · ${data.senal.sinLlamar} sin llamar`
                : `${data.interesadosTotal.toLocaleString("es")} con señal ahora mismo`
            }
          />
          <OrigenCard
            href={enlaceDemandas()} icon={Inbox} label="Demandas"
            datos={data.demandas} periodo={periodo}
            tono="verde"
            extra={extraDemandas()}
          />
          <OrigenCard
            href={enlaceLeads(data.fuentes.rrss)} icon={Share2} label="Redes sociales"
            datos={data.origenes.rrss} periodo={periodo}
            tono="rosa"
          />
          {/* A /leads y no a /galeria-qr: esta tarjeta cuenta LEADS que entraron
              por un código, no códigos. La galería es otra pantalla y se entra a
              ella por el menú. */}
          <OrigenCard
            href={enlaceLeads(data.fuentes.qr)} icon={QrCode} label="Códigos QR"
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
