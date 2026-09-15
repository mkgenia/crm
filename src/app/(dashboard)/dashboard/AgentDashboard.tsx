"use client"

import Link from "next/link"
import {
  Building2, UserCircle, TrendingUp, MessageSquare, CalendarClock,
  Phone, AlertTriangle, Home, Target, Radar, Share2, Globe, QrCode, Inbox,
} from "lucide-react"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import type { EntradaAgenda, PersonaAgenda } from "@/lib/agenda"
import { cn } from "@/lib/utils"
import { nombreDe, colorDe, claseColor, clasePunto, type Catalogo } from "@/lib/catalogos"

/**
 * La portada del agente.
 *
 * Ni un solo estado escrito aquí. Antes había tres mapas a mano —etiquetas de
 * lead, estilos de lead y estilos de WhatsApp— con los mismos dos problemas de
 * siempre: un estado creado desde /configuracion/catalogos no salía por ningún
 * lado, y un estado que no estuviera en el mapa pintaba un hueco. Ahora el
 * nombre sale de `nombreDe` y el color de `colorDe`, que caen a gris y al propio
 * valor cuando algo no está catalogado, así que una fila con un estado retirado
 * se sigue leyendo.
 *
 * Todos los relativos ("hace 3 h", "vencido hace 2 días") llegan ya calculados
 * desde el servidor. Calcularlos aquí durante el render los haría depender de
 * Date.now(), que en el servidor y en el navegador no es el mismo y React lo
 * cantaría como desajuste de hidratación.
 */

/**
 * Los tres ámbitos de `v_mi_dia`. NO es una lista de estados: son las tres
 * tablas que une la vista en la migración 024, y cambiarlas es cambiar el SQL.
 * Lo que sí sale del catálogo es la señal de cada fila, y por eso cada ámbito
 * dice de qué catálogo es la suya.
 */
const AMBITOS: Record<string, {
  etiqueta: string
  catalogo: string
  href: string
  icono: React.ElementType
  chip: string
}> = {
  captacion: {
    etiqueta: "Captación", catalogo: "estado_whatsapp", href: "/captaciones", icono: Building2,
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20",
  },
  prospecto: {
    etiqueta: "Prospecto", catalogo: "estado_prospecto", href: "/prospectos", icono: Home,
    chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border-cyan-500/20",
  },
  lead: {
    etiqueta: "Lead", catalogo: "estado_lead", href: "/leads", icono: Target,
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  },
}

const AMBITO_DESCONOCIDO = {
  etiqueta: "Contacto", catalogo: "estado_lead", href: "/contactos", icono: UserCircle,
  chip: "bg-muted text-muted-foreground border-border",
}

/** Cuántas filas del día se ven sin desplegar. El resto va en un `<details>`. */
const VISIBLES = 8

/**
 * La fuente del lead ESPEJO de una captación.
 *
 * No sale del catálogo y no es una lista de valores escondida: es UN valor de
 * sistema que escriben el trigger de reparto (024:178) y la propia vista
 * (033:69 y 033:76), igual que `AMBITOS` de aquí arriba nombra los tres ámbitos
 * que une la vista. `page.tsx` lo tiene declarado con el mismo nombre y por el
 * mismo motivo (408-411).
 */
const FUENTE_ESPEJO = "Captaciones"

export interface FilaDia {
  clave: string
  ambito: string
  titulo: string
  barrio: string | null
  telefono: string | null
  senal: string | null
  /**
   * De dónde vino esta fila, como valor del catálogo `fuente` (llega con la
   * migración 033). Puede ser null: un lead sin origen anotado los hay.
   */
  fuente: string | null
  motivo: string | null
  vencido: boolean
  /** "vencido hace 2 días" o "para el 18/09 09:00". Calculado en el servidor. */
  toqueTexto: string | null
  /** "sin atender, entró hace 3 meses" o "última llamada hace 5 días". */
  esperaTexto: string | null
  nuncaAtendido: boolean
}

export interface AgentData {
  captaciones: number | null
  captacionesEsteMes: number | null
  wa: Array<{ valor: string; nombre: string; color: string | null; count: number | null }>
  /** Las captaciones activas a las que todavía no se ha escrito: no son de
   *  ningún valor del catálogo y sin esto no salían en ninguna pastilla. */
  waSinEstado: number | null
  interesadosTotal: number | null
  tasaRespuesta: number | null
  leadsTotal: number | null
  /**
   * De dónde vienen sus leads. Una entrada por valor ACTIVO del catálogo
   * `fuente`, con nombre y color ya resueltos en el servidor.
   *
   * `total` es el denominador del PROPIO bloque y no tiene por qué coincidir
   * con `leadsTotal`: aquí no entran los leads espejo de sus captaciones.
   */
  origenes: {
    total: number | null
    sinFuente: number | null
    fueraDeCatalogo: number | null
    porFuente: Array<{
      valor: string; nombre: string; color: string | null
      total: number | null; semana: number | null
    }>
  }
  pipeline: Array<{ estado: string; count: number | null }>
  agenda: Array<{
    id: number; nombre: string | null; telefono: string | null; direccion: string | null
    estado_whatsapp: string | null; cuando: string | null; notas: string | null
  }>
  dia: {
    filas: FilaDia[]
    total: number | null
    vencidos: number | null
    sinAtender: number | null
    error: boolean
  }
}

export default function AgentDashboard({ nombre, saludo, data, catalogos, agendaEquipo, yoId }: {
  nombre: string
  saludo: string
  data: AgentData
  catalogos: Catalogo[]
  agendaEquipo: { entradas: EntradaAgenda[]; personas: PersonaAgenda[]; disponible: boolean }
  yoId: string
}) {
  // Sólo suma lo que se ha podido contar. Si TODOS los contadores fallaron no se
  // pinta la barra: una barra vacía dice "no tienes leads", que es distinto de
  // "no se han podido contar".
  const conteos = data.pipeline.map((p) => p.count).filter((c): c is number => c != null)
  const totalPipeline = conteos.reduce((s, c) => s + c, 0)
  const pipelineMedido = conteos.length > 0

  // El bloque de WhatsApp sólo existe si tiene captaciones. Si el contador
  // falló (null) el bloque SÍ se pinta, para poder decir que falló.
  const hayWa = data.captaciones == null || data.captaciones > 0
  const waVisible = data.wa.filter((i) => i.count == null || i.count > 0)
  const waTotal =
    data.wa.reduce((s, i) => s + (i.count ?? 0), 0) + (data.waSinEstado ?? 0)

  const { filas } = data.dia
  const primeras = filas.slice(0, VISIBLES)
  const resto = filas.slice(VISIBLES)
  // Lo que no cabe en las 40 filas que se traen. Sale del count exacto, no de
  // contar las filas cargadas.
  const noCargadas = data.dia.total != null ? Math.max(0, data.dia.total - filas.length) : 0

  // La cabecera se arma como lista y se une con " · ", en vez de concatenar tres
  // trozos que ya traen el separador pegado delante: si el primer contador falla
  // —que es justo el caso que esto quiere cubrir— la línea empezaba por " · 3
  // vencidos", que se lee como si faltara algo. Y si fallan los tres no se pinta
  // el párrafo, en lugar de dejar una línea en blanco.
  const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)
  const resumenDia = [
    data.dia.total != null ? `${data.dia.total.toLocaleString("es")} en tu lista` : null,
    data.dia.vencidos != null && data.dia.vencidos > 0
      ? `${data.dia.vencidos.toLocaleString("es")} ${plural(data.dia.vencidos, "vencido", "vencidos")}`
      : null,
    data.dia.sinAtender != null && data.dia.sinAtender > 0
      ? `${data.dia.sinAtender.toLocaleString("es")} sin atender nunca`
      : null,
  ].filter((t): t is string => t != null)

  return (
    <div className="p-8 flex flex-col gap-8">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">
          {saludo},{" "}
          <span className="holo-text">{nombre}</span>
        </h1>
        <p className="text-sm text-muted-foreground">Tu actividad personal</p>
      </div>

      {/*
        LO QUE TOCA HOY va lo primero, antes que ninguna tarjeta.
        El agente entra por la mañana y lo que necesita no es un número: es a
        quién llama ahora y con qué teléfono.
      */}
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              Lo que toca hoy
            </h2>
            {/* Cada contador que falló se calla, no se inventa un cero. */}
            {resumenDia.length > 0 && (
              <p className="text-xs text-muted-foreground">{resumenDia.join(" · ")}</p>
            )}
          </div>
        </div>

        {data.dia.error ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              No se ha podido cargar tu lista de hoy. Vuelve a entrar en un momento; si sigue
              igual, avisa: es un fallo de la consulta, no que no tengas nada pendiente.
            </p>
          </div>
        ) : filas.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-10 text-center flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              No tienes nada asignado ahora mismo.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Aquí aparecerán tus captaciones, tus prospectos y tus leads de Instagram o web
              en cuanto se te repartan.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {primeras.map((f) => <FilaDelDia key={f.clave} fila={f} catalogos={catalogos} />)}
            </div>

            {resto.length > 0 && (
              // Un <details> y no un useState: es plegar y desplegar, no estado
              // de la aplicación, y así funciona igual antes de hidratar.
              <details className="group rounded-lg border border-border bg-card overflow-hidden">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                  Ver {resto.length} más
                  <span className="inline-block transition-transform group-open:rotate-90"> ›</span>
                </summary>
                <div className="divide-y divide-border border-t border-border">
                  {resto.map((f) => <FilaDelDia key={f.clave} fila={f} catalogos={catalogos} />)}
                </div>
              </details>
            )}

            {noCargadas > 0 && (
              <p className="text-xs text-muted-foreground/70">
                Y {noCargadas.toLocaleString("es")} más en tus listas. Aquí sólo salen los{" "}
                {filas.length} que tocan antes.
              </p>
            )}
          </div>
        )}
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          href="/captaciones"
          icon={Building2} label="Mis captaciones" value={data.captaciones}
          sub={data.captacionesEsteMes != null ? `${data.captacionesEsteMes} este mes` : "activas"} holo
        />
        <KpiCard
          href="/leads"
          icon={UserCircle} label="Mis leads" value={data.leadsTotal}
          sub="asignados a ti"
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

      <SeccionOrigenes data={data} />

      {/* WA stats + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* El desglose de WhatsApp deja de ser una rejilla de diez casillas: es
            la misma barra apilada + leyenda que 'Mi pipeline de leads' tiene al
            lado. Un estado a cero NO sale (ahí estaban nueve de las diez); uno
            que no se ha podido contar SÍ sale, con '—'. Y si el agente no tiene
            captaciones, el bloque no existe: contarle en diez cajas que no tiene
            ninguna era el ejemplo exacto de embudo que no sirve para nada. */}
        {hayWa && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              Estado WhatsApp · mis captaciones
            </h2>
            <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4 h-[calc(100%-2.5rem)]">
              {data.captaciones == null ? (
                // Un fallo al contar NO esconde el bloque: esconderlo sería
                // esconder el fallo.
                <p className="text-sm text-muted-foreground">No se han podido contar tus captaciones</p>
              ) : waVisible.length === 0 && !(data.waSinEstado != null && data.waSinEstado > 0) ? (
                // Ni una sola pastilla que pintar y el agente SÍ tiene
                // captaciones: sin esta frase el bloque quedaba como una caja
                // con borde y nada dentro. Pasa de verdad —no es un imposible—
                // porque la 027 archivó `Interesado` y `Quiere_Llamada`: una
                // captación que siga en un estado archivado no cae en ninguna
                // pastilla del catálogo activo y tampoco cuenta como "sin
                // escribir", que mira `estado_whatsapp IS NULL`.
                <p className="text-sm text-muted-foreground">
                  Tus captaciones no están en ninguno de los estados de WhatsApp del catálogo
                </p>
              ) : (
                <>
                  {waTotal > 0 && (
                    <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
                      {data.wa.map((i) =>
                        i.count && i.count > 0 ? (
                          <div key={i.valor}
                            style={{ width: `${(i.count / waTotal) * 100}%` }}
                            className={cn("rounded-sm", clasePunto(i.color))}
                            title={`${i.nombre}: ${i.count}`} />
                        ) : null
                      )}
                      {data.waSinEstado != null && data.waSinEstado > 0 && (
                        <div style={{ width: `${(data.waSinEstado / waTotal) * 100}%` }}
                          className="rounded-sm bg-muted-foreground/25"
                          title={`Sin escribir: ${data.waSinEstado}`} />
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {waVisible.map((i) => (
                      <div key={i.valor} className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", clasePunto(i.color))} />
                        <span className="text-xs text-muted-foreground">{i.nombre}</span>
                        <span className="text-xs font-medium text-foreground tabular-nums">
                          {i.count != null ? i.count.toLocaleString("es") : "—"}
                        </span>
                      </div>
                    ))}
                    {/* El hueco de las que aún no tienen estado. Sin esto el
                        desglose suma menos que 'Mis captaciones'. */}
                    {data.waSinEstado != null && data.waSinEstado > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shrink-0 border border-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground">Sin escribir</span>
                        <span className="text-xs font-medium text-foreground tabular-nums">
                          {data.waSinEstado.toLocaleString("es")}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className={cn("flex flex-col gap-4", !hayWa && "lg:col-span-2")}>
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            Mi pipeline de leads
          </h2>
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col gap-4 h-[calc(100%-2.5rem)]">
            {pipelineMedido && totalPipeline > 0 ? (
              <>
                {/* El color de cada tramo sale del catálogo (clasePunto), no de
                    una paleta escrita aquí que no tenía por qué coincidir con la
                    pastilla del mismo estado en /leads. El ancho va en `style`
                    porque es un porcentaje: una clase `w-[43%]` por plantilla la
                    purgaría Tailwind al compilar. */}
                <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
                  {data.pipeline.map((p) =>
                    p.count && p.count > 0 ? (
                      <div key={p.estado}
                        style={{ width: `${(p.count / totalPipeline) * 100}%` }}
                        className={cn("rounded-sm", clasePunto(colorDe(catalogos, "estado_lead", p.estado)))}
                        title={`${nombreDe(catalogos, "estado_lead", p.estado)}: ${p.count}`}
                      />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {data.pipeline.map((p) => (
                    <div key={p.estado} className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", clasePunto(colorDe(catalogos, "estado_lead", p.estado)))} />
                      <span className="text-xs text-muted-foreground">{nombreDe(catalogos, "estado_lead", p.estado)}</span>
                      <span className="text-xs font-medium text-foreground tabular-nums">
                        {p.count != null ? p.count : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 py-6">
                <p className="text-sm text-muted-foreground text-center">
                  {pipelineMedido ? "Aún no tienes leads asignados" : "No se ha podido contar tu pipeline"}
                </p>
                <Link href="/leads" className="text-xs text-primary hover:underline">Ver todos los leads →</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {agendaEquipo.disponible ? (
        <AgendaPanel
          entradasIniciales={agendaEquipo.entradas}
          personas={agendaEquipo.personas}
          yoId={yoId}
          isAdmin={false}
        />
      ) : null}

      {/* Visitas ya agendadas sobre captaciones, que es otra cosa que el calendario */}
      {data.agenda.length > 0 ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
            Agenda próxima
          </h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
            {data.agenda.map((item) => (
              <div key={item.id} className="flex items-start gap-4 px-5 py-4 hover:bg-muted/40 transition-colors">
                <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.nombre} {item.direccion ? `· ${item.direccion}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.cuando ?? "—"}
                    {item.notas ? ` · ${item.notas}` : ""}
                  </p>
                </div>
                {item.estado_whatsapp && (
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded border font-medium shrink-0",
                    claseColor(colorDe(catalogos, "estado_whatsapp", item.estado_whatsapp)),
                  )}>
                    {nombreDe(catalogos, "estado_whatsapp", item.estado_whatsapp)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/*
        AQUÍ ESTABA "MIS ÚLTIMOS LEADS", y se ha quitado a propósito.
        Enseñaba los seis leads más nuevos del agente, que con la lista de
        arriba son LAS MISMAS PERSONAS otra vez: en el agente de pruebas salían
        las siete dos veces en la misma pantalla. Lo único que aportaba era de
        dónde venía cada uno, y eso ahora lo dice cada fila de "Lo que toca hoy"
        desde la 033.

        Lo que se pierde: `v_mi_dia` deja fuera los leads en 'Ganado' y
        'Perdido' y las captaciones ya promocionadas, y esa lista sí los
        enseñaba. Es deliberado —la portada es para lo que hay que hacer, no
        para el archivo— y los Ganados se siguen viendo en el pipeline de aquí
        al lado.
      */}
    </div>
  )
}

/**
 * Una fila de "lo que toca hoy".
 *
 * De qué es, cómo se llama, de dónde vino, desde cuándo espera, por qué hay que
 * llamarle y el teléfono en un enlace `tel:` — que en el móvil es pulsar y
 * hablar, y en el escritorio abre el marcador. Es el único botón que de verdad
 * hace falta aquí.
 *
 * El origen entró con la 033 y no es adorno: sin él un lead de Instagram y uno
 * del formulario de la web salían idénticos —los dos decían sólo "LEAD"— y no
 * se trabaja igual a quien escribe por un anuncio que a quien pide una visita.
 */
function FilaDelDia({ fila, catalogos }: { fila: FilaDia; catalogos: Catalogo[] }) {
  const meta = AMBITOS[fila.ambito] ?? AMBITO_DESCONOCIDO
  const Icono = meta.icono

  // ARREGLADO EN REVISIÓN: el origen sólo se pinta cuando DICE algo que no diga
  // ya el chip del ámbito.
  //
  // La vista no lee la fuente de una captación: la escribe como literal
  // ('Captaciones', 033:69), y la del prospecto cae al mismo valor por COALESCE
  // (033:76) porque un prospecto nace siempre de una captación. O sea que en
  // esas dos filas la columna es una CONSTANTE, no un dato. Pintada, cada
  // captación repetía "Captador Idealista" tres milímetros debajo de su chip
  // "CAPTACIÓN", y encima en el mismo violeta: el catálogo le da `violet` a esa
  // fuente (012:98) y `AMBITOS` el mismo violeta al ámbito. La misma palabra y
  // el mismo color dos veces en la misma fila, que es justo lo que esta pantalla
  // acaba de quitar a lo grande.
  //
  // Un lead nunca llega con este valor —la vista excluye los espejos, 033:90—,
  // así que esto no esconde ningún origen de verdad: el prospecto que SÍ traiga
  // la fuente del lead del que nació (Instagram, Web…) la sigue enseñando.
  const origen = fila.fuente && fila.fuente !== FUENTE_ESPEJO ? fila.fuente : null

  return (
    <div className={cn(
      "flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/40",
      // Lo vencido lleva un filo rojo a la izquierda: se distingue de un
      // vistazo sin leer una sola palabra.
      fila.vencido && "border-l-2 border-l-rose-500 bg-rose-500/[0.04]",
    )}>
      <Icono className={cn("h-4 w-4 shrink-0 mt-0.5", fila.vencido ? "text-rose-500" : "text-muted-foreground")} />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide", meta.chip)}>
            {meta.etiqueta}
          </span>
          <Link href={meta.href} className="text-sm font-medium text-foreground truncate hover:underline">
            {fila.titulo}
          </Link>
          {fila.barrio && (
            <span className="text-xs text-muted-foreground truncate">· {fila.barrio}</span>
          )}
          {/* La columna `senal` de v_mi_dia no viene de un solo catálogo: desde
              la 027 es COALESCE(c.senal, c.estado_whatsapp) para las captaciones,
              así que puede traer "interesado" —que vive en `senal_interes`— o
              "Respondido" —que vive en `estado_whatsapp`—. Buscando sólo en el
              catálogo del ámbito, justo las que interesan —las que tienen señal,
              que son las que se reparten— salían en gris y en minúscula
              ("interesado") mientras en /captaciones salen como "Le interesa" en
              verde. Se prueba primero el de la señal y se cae al del ámbito. */}
          {fila.senal && (() => {
            const cat = colorDe(catalogos, "senal_interes", fila.senal) ? "senal_interes" : meta.catalogo
            return (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded border font-medium shrink-0",
                claseColor(colorDe(catalogos, cat, fila.senal)),
              )}>
                {nombreDe(catalogos, cat, fila.senal)}
              </span>
            )
          })()}
        </div>

        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
          {/* EL ORIGEN, en la línea de abajo y como punto de color, no arriba y
              en pastilla.

              Arriba se pelean ya tres cosas por la primera línea —el chip del
              ámbito, el nombre y el chip de la señal—: una cuarta pastilla
              empujaría el nombre fuera, que es justo lo que se busca al mirar la
              fila. Y la señal es la única pastilla que tiene que gritar, porque
              es la que dice a quién llamar antes.

              Abajo va con la misma pareja punto+texto que las leyendas del
              pipeline y de WhatsApp de esta misma pantalla, así que el color de
              Instagram significa Instagram en los tres sitios. Y va PRIMERO de
              la línea porque es lo más estable que hay en ella: el ojo lo busca
              siempre en el mismo sitio y lo que cambia a cada rato —cuánto lleva
              esperando, el motivo— cae detrás.

              Y no repite lo que ya dice el chip del ámbito: lo que sería una
              copia suya —la fuente del espejo de una captación— se filtra
              arriba, en `origen`.

              Si no hay fuente anotada no se pinta nada: `nombreDe` devolvería
              "—" y una raya suelta al principio de la línea se lee como un
              fallo, no como un dato que falta. */}
          {origen && (
            <>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  clasePunto(colorDe(catalogos, "fuente", origen)),
                )} />
                {/* `truncate` y `min-w-0`: en el móvil esta columna se queda en
                    unos 140 px con el botón de llamar al lado, y "Solicitud
                    valoración" no cabe. Sin esto la palabra se salía de la
                    tarjeta en vez de cortarse. */}
                <span className="text-muted-foreground truncate">
                  {nombreDe(catalogos, "fuente", origen)}
                </span>
              </span>
              {(fila.toqueTexto || fila.esperaTexto) && (
                <span className="text-muted-foreground/40">·</span>
              )}
            </>
          )}
          {fila.toqueTexto && (
            <span className={cn(
              "font-medium",
              fila.vencido ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
            )}>
              {fila.vencido && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse mr-1.5 align-middle" />
              )}
              {fila.toqueTexto}
            </span>
          )}
          {fila.toqueTexto && fila.esperaTexto && <span className="text-muted-foreground/40">·</span>}
          {fila.esperaTexto && (
            <span className={cn(
              fila.nuncaAtendido ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}>
              {fila.esperaTexto}
            </span>
          )}
          {/* El motivo del próximo toque es lo que escribió el propio agente al
              colgar la última vez. Sin él, "llamar" no dice para qué. */}
          {fila.motivo && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground italic truncate">{fila.motivo}</span>
            </>
          )}
        </div>
      </div>

      {fila.telefono ? (
        <a
          href={`tel:${fila.telefono.replace(/\s+/g, "")}`}
          className="shrink-0 flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 hover:border-muted-foreground/40 transition-colors tabular-nums"
        >
          <Phone className="h-3 w-3" />
          <span className="hidden sm:inline">{fila.telefono}</span>
          <span className="sm:hidden">Llamar</span>
        </a>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground/60">Sin teléfono</span>
      )}
    </div>
  )
}

function KpiCard({ href, icon: Icon, label, value, sub, holo, suffix }: {
  href?: string; icon: React.ElementType; label: string; value: number | null; sub: string; holo?: boolean; suffix?: string
}) {
  const inner = (
    <div className={cn(
      "relative rounded-lg border p-5 flex flex-col gap-3 bg-card overflow-hidden transition-all",
      holo ? "holo-border holo-glow border-transparent" : "border-border",
      href && "hover:bg-muted/40 cursor-pointer",
    )}>
      {holo && (
        <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.65_0.22_295/0.06)] via-[oklch(0.80_0.15_200/0.04)] to-transparent pointer-events-none" />
      )}
      <div className="flex items-center justify-between relative">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="relative flex flex-col gap-0.5">
        {/* Un contador que no se ha podido contar enseña una raya, no un cero.
            El cero de un fallo se lee como "no tienes ninguno". */}
        <p className={cn("text-3xl font-semibold tracking-tight", holo ? "holo-text" : "text-foreground")}>
          {value != null ? `${value.toLocaleString("es")}${suffix ?? ""}` : "—"}
        </p>
        <p className="text-xs text-muted-foreground">{value != null ? sub : "no se ha podido contar"}</p>
      </div>
    </div>
  )
  if (href) return <Link href={href}>{inner}</Link>
  return inner
}

/**
 * Los iconos son un mapa a mano y no salen del catálogo porque la tabla
 * `catalogos` no tiene columna de icono (es {id,tipo,valor,nombre,color,orden,
 * activo,sistema}). Lo que SÍ sale del catálogo es lo que importa: el nombre y
 * el color, que ya están puestos desde la migración 012. Se indexa por `valor`,
 * que es la clave estable, y NO por `nombre`, que el administrador edita. Una
 * fuente nueva sale con `Inbox` y con su nombre y su color buenos: nunca un
 * hueco. El arreglo definitivo sería una columna `icono` en `catalogos`, y no
 * toca hacerla hoy.
 */
const ICONO_FUENTE: Record<string, React.ElementType> = {
  Captaciones: Radar,
  Instagram: Share2,
  Propiedades: Building2,
  Web: Globe,
  WhatsApp: MessageSquare,
  QR: QrCode,
  "Solicitud valoración": Home,
  "Trasteros WhatsApp": Inbox,
}

function SeccionOrigenes({ data }: { data: AgentData }) {
  const o = data.origenes
  const conTarjeta = o.porFuente.filter((f) => f.total != null && f.total > 0)
  const enFallo    = o.porFuente.filter((f) => f.total == null)
  const aCero      = o.porFuente.filter((f) => f.total === 0)
  // LOS RESTOS, por dos caminos.
  //
  // El bueno es el par de contadores. Pero si UNO de los dos falla, el residuo
  // se DEDUCE del total: lo repartido menos lo que han contado las fuentes. Sin
  // esa segunda vía, un solo contador caído se llevaba por delante la línea que
  // hace cuadrar la suma —las tarjetas enseñando 5 debajo de un titular que
  // dice 7, y nada que lo explique— y, si además ninguna fuente tenía tarjeta,
  // arrastraba a `hayQueEnsenyar` al estado vacío: "todavía no te han repartido
  // ningún lead" encima de siete. El número deducido es el mismo siempre que
  // todas las fuentes se hayan podido contar, que es justo lo que se comprueba.
  const sumaFuentes = o.porFuente.reduce((s, f) => s + (f.total ?? 0), 0)
  const restos =
    o.sinFuente != null && o.fueraDeCatalogo != null
      ? o.sinFuente + o.fueraDeCatalogo
      : o.total != null && enFallo.length === 0
        ? o.total - sumaFuentes
        : null
  // `> 0` y no `!= null`: un residuo negativo sólo puede salir de que un lead
  // cambie de fuente entre dos de las diecinueve consultas, y eso no se pinta.
  const hayRestos = restos != null && restos > 0
  // Sin catálogo de fuentes no hay nada con lo que desglosar, y eso NO es "no
  // te han repartido nada": con `fuentes` vacío page.tsx deja `fueraDeCatalogo`
  // en null a propósito (509) y aquí no llegaría ni una tarjeta, así que el
  // estado vacío diría "todavía no te han repartido ningún lead" tres píxeles
  // debajo de "1.021 leads repartidos". Sólo se enseña el vacío cuando el total
  // es un cero medido.
  const todoRoto = o.porFuente.length > 0
    ? enFallo.length === o.porFuente.length
    : o.total == null || o.total > 0

  // ORDEN: por el `orden` del catálogo, que ya viene aplicado por `opcionesDe`.
  // NO por número descendente: con 7 leads un lead nuevo reordena las tarjetas
  // entre recargas y la pantalla parece otra. El número grande ya salta a la
  // vista solo; la posición fija vale más.
  const tarjetas = [...conTarjeta, ...enFallo]

  // El bloque tiene algo que enseñar si hay tarjetas O si hay restos.
  //
  // Sin la segunda mitad, un agente al que TODOS sus leads le llegaron sin
  // fuente anotada —o con una fuente que el administrador retiró del catálogo—
  // leía "Todavía no te han repartido ningún lead" justo debajo de "3 leads
  // repartidos": dos frases contrarias a dos centímetros, y los tres leads
  // desaparecidos, porque la línea de los restos vive en la otra rama. Cero
  // leads y "ninguno encaja en una tarjeta" no son lo mismo.
  const hayQueEnsenyar = tarjetas.length > 0 || hayRestos

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
          De dónde vienen tus leads
        </h2>
        {/* El bloque declara SU PROPIO denominador, contado con sus mismos
            filtros. No es el KPI 'Mis leads' de arriba: aquí no entran los
            leads espejo de sus captaciones, y la segunda frase lo dice en vez
            de dejar un descuadre sin explicar. */}
        {o.total != null && (
          <p className="text-xs text-muted-foreground">
            {o.total.toLocaleString("es")} {o.total === 1 ? "lead repartido" : "leads repartidos"}
            {data.captaciones != null && data.captaciones > 0 && (
              <> · tus captaciones van aparte, en <Link href="/captaciones" className="hover:text-foreground underline underline-offset-2">captaciones</Link></>
            )}
          </p>
        )}
      </div>

      {todoRoto ? (
        // ESTADO ROTO. Calcado del recuadro de `data.dia.error` (línea 178).
        // Cero y fallo no comparten pintura nunca.
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            No se ha podido contar de dónde vienen tus leads. Vuelve a entrar en un momento;
            si sigue igual, avisa: es un fallo de la consulta, no que no tengas leads.
          </p>
        </div>
      ) : !hayQueEnsenyar ? (
        // ESTADO VACÍO. Mismo `border-dashed` que ya se usa en 186 y 382. Los
        // nombres salen del catálogo, no escritos aquí.
        <div className="border border-dashed border-border rounded-lg p-10 text-center flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Todavía no te han repartido ningún lead.</p>
          <p className="text-xs text-muted-foreground/70">
            Cuando te asignen uno, aquí verás por dónde entró
            {o.porFuente.length > 0 && <>: {o.porFuente.slice(0, 4).map((f) => f.nombre).join(", ")}…</>}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* grid-cols-2 en móvil y lg:grid-cols-4: rima con la fila de KPIs de
              arriba, que ya es grid-cols-2 lg:grid-cols-4.
              La rejilla sólo existe si hay alguna tarjeta: se puede llegar aquí
              con cero tarjetas y sólo restos —todos sus leads sin fuente— y una
              rejilla vacía dejaría el hueco del `gap` del padre delante de la
              frase, como si faltara algo. */}
          {tarjetas.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {tarjetas.map((f) => {
              const Icono = ICONO_FUENTE[f.valor] ?? Inbox
              return (
                // El número lleva a SUS leads de ESE canal, no a la lista
                // entera. /leads ya lee `?fuente=` en el servidor y valida el
                // valor contra el catálogo (leads/page.tsx:36), así que aquí
                // basta con pasar el `valor` —la clave estable, no el nombre,
                // que el administrador edita—. Sin esto, pulsar "Instagram 121"
                // abría los 1.021 leads sin filtrar: un contador que no lleva a
                // ninguna parte se deja de mirar a la semana.
                <Link key={f.valor} href={`/leads?fuente=${encodeURIComponent(f.valor)}`}
                  className="rounded-xl border border-border bg-card px-4 py-4 flex flex-col gap-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border",
                      claseColor(f.color),
                    )}>
                      <Icono className="h-4 w-4" />
                    </span>
                    <span className="text-[13px] font-medium text-foreground/90 truncate">{f.nombre}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {/* Misma fórmula que KpiCard (531-536): un contador que
                        falló enseña una raya, no un cero. Un cero nunca llega
                        a una tarjeta: esa fuente se va a la frase del pie. */}
                    <p className="text-[2.6rem] font-bold tabular-nums leading-[0.85] tracking-tight text-foreground">
                      {f.total != null ? f.total.toLocaleString("es") : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {/* La semana que NO se ha podido contar lo dice. Antes
                          pintaba un espacio, y un espacio dentro de un <p> se
                          colapsa: la línea desaparecía y el fallo se leía
                          igual que "nada nuevo esta semana", que es cero. Cero
                          y fallo no se confunden nunca. */}
                      {f.total == null
                        ? "no se ha podido contar"
                        : f.semana == null
                          ? "— esta semana"
                          : f.semana > 0
                            ? `${f.semana} esta semana`
                            : "nada nuevo esta semana"}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
          )}

          {/* LA LÍNEA QUE MATA LA REJILLA DE CEROS. Un canal a cero se sigue
              nombrando —existe y está vacío, no roto— pero en una frase, no en
              una casilla por barba. */}
          {aCero.length > 0 && (
            <p className="text-[11px] text-muted-foreground/70">
              Todavía no te ha llegado nada por {listaEs(aCero.map((f) => f.nombre))}.
            </p>
          )}

          {/* LA LÍNEA DE LOS RESTOS. Es lo que hace que la suma cuadre con el
              total del bloque. Si alguno de sus dos contadores falló, se calla:
              no se pinta un '—' para un residuo. */}
          {hayRestos && (
            <p className="text-[11px] text-muted-foreground/70">
              {restos.toLocaleString("es")} {restos === 1 ? "lead" : "leads"} con un origen que
              no está en el catálogo o sin origen anotado.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** "Instagram, Código QR ni Trasteros". Une con comas y un 'ni' al final. */
function listaEs(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ""
  return `${nombres.slice(0, -1).join(", ")} ni ${nombres[nombres.length - 1]}`
}
