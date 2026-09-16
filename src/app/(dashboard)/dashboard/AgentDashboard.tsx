"use client"

import Link from "next/link"
import {
  Building2, UserCircle, CalendarClock, CalendarDays,
  Phone, AlertTriangle, Home, Target, Radar, Share2, Globe, Inbox, Heart,
} from "lucide-react"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import type { EntradaAgenda, PersonaAgenda } from "@/lib/agenda"
import { cn } from "@/lib/utils"
import { nombreDe, colorDe, claseColor, clasePunto, type Catalogo } from "@/lib/catalogos"
// LA MISMA TARJETA QUE PINTA EL ADMINISTRADOR. Vivía dentro de
// `AdminDashboard.tsx` y se ha sacado a un fichero compartido para poder
// enseñarle al agente sus seis, que son las seis de él.
import { OrigenCard } from "@/components/dashboard/origen-card"

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
 * mismo motivo, dentro de `getAgentData`.
 *
 * ARREGLADO EN REVISIÓN: aquí ponía un número de línea de `page.tsx`, y ese
 * fichero se ha vuelto a mover entero con las seis tarjetas. Se nombra la
 * función, que no se desplaza sola; el número mandaba a otra parte al día
 * siguiente —la primera vez cayó en los leads recientes del ADMINISTRADOR—.
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
  /**
   * Sus tareas del calendario SIN COMPLETAR, partidas en tres.
   *
   * Tres números y no uno porque la tarjeta tiene que poder decir de qué están
   * hechos: "9" no es lo mismo si son nueve de hoy o siete vencidas y dos de
   * hoy. Cada uno puede valer null por su cuenta —un contador que falla no es
   * un cero— y `semana` son los SIETE DÍAS SIGUIENTES, sin contar hoy: es lo
   * que evita que la tarjeta de un martes tranquilo se quede en un cero mudo.
   */
  tareas: {
    vencidas: number | null
    hoy: number | null
    semana: number | null
  }
  /**
   * SUS LEADS POR FAMILIA DE FUENTE, que son dos de las seis tarjetas.
   *
   * No hay una entrada por cada valor del catálogo: hay DOS, las dos que pidió
   * el dueño. Los nombres de `fuente` los escriben workflows distintos y no hay
   * CHECK que los sujete, así que cada tarjeta agrupa una familia de valores
   * (page.tsx) y no un valor suelto: Instagram y Facebook son la misma tarjeta.
   *
   * `total` es lo repartido desde el principio y `semana`, lo que le han
   * repartido en los últimos siete días. Cada uno falla por su cuenta y un null
   * es un contador roto, nunca un cero.
   */
  canales: {
    rrss: { total: number | null; semana: number | null }
    web: { total: number | null; semana: number | null }
  }
  /**
   * LAS DEMANDAS, QUE SON DE LA EMPRESA Y NO SUYAS.
   *
   * La tabla `demandas` no tiene columna de agente: una demanda es de un PISO,
   * no de una persona. O sea que este número es el MISMO para los seis agentes
   * y para el administrador, y la tarjeta tiene que decirlo con palabras (ver
   * dónde se pinta). Se llama `demandasEmpresa` y no `demandas` justamente para
   * que nadie las confunda con algo suyo al leer este contrato.
   */
  demandasEmpresa: {
    total: number | null
    sinVer: number | null
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

  // LA TARJETA DEL CALENDARIO, que era "Mis tareas" de la fila de arriba y hoy
  // es la quinta de las seis.
  //
  // El número grande es lo ACCIONABLE: lo vencido más lo de hoy. No el total
  // histórico de la agenda, que a los seis meses son cientos de tareas hechas y
  // no contesta a nada; y tampoco sólo las de hoy, porque una tarea de ayer sin
  // hacer no se va a hacer en el pasado — sigue siendo trabajo de hoy, y es
  // justo la que se olvida. Es la misma cuenta que hace el comercial a las
  // nueve de la mañana: qué tengo que despachar antes de irme a casa.
  //
  // Si CUALQUIERA de los dos sumandos falló, el total es null y la tarjeta se
  // pinta entera como fallo ("No se ha podido contar", en ámbar y sin número):
  // media suma no es un número aproximado, es un número inventado.
  const { vencidas, hoy, semana } = data.tareas
  const tareasAhora = vencidas == null || hoy == null ? null : vencidas + hoy

  // La línea de abajo desmonta el número —nueve no es lo mismo si son siete
  // vencidas que si son nueve de hoy— y, cuando no hay nada que desmontar,
  // mira a la semana que viene en vez de dejar un cero sin explicar. Un cero
  // con "no tienes nada pendiente" se lee como lo que es; un cero solo, en una
  // portada llena de números, se lee como que algo no ha cargado.
  const subTareas =
    vencidas == null || hoy == null
      ? "" // no llega a pintarse: la tarjeta dice "No se ha podido contar"
      : vencidas > 0
        ? `${vencidas} ${plural(vencidas, "vencida", "vencidas")} · ${hoy} para hoy`
        : hoy > 0
          ? "para hoy, nada vencido"
          : semana == null
            ? "nada para hoy ni vencido"
            : semana > 0
              ? `nada para hoy · ${semana} en los próximos 7 días`
              // "ni esta semana" y no "no tienes nada pendiente": los tres
              // contadores sólo miran hasta dentro de siete días, así que una
              // tarea apuntada para dentro de tres semanas existe y este cero
              // no puede negarla.
              : "nada para hoy ni esta semana"

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

      {/* LAS SEIS TARJETAS, LAS MISMAS QUE TIENE EL ADMINISTRADOR.
          Las pidió así el dueño, una por una: redes sociales, web, scraper,
          demandas, calendario y matches. Seis y ni una más.

          AQUÍ HABÍA DIEZ COSAS: dos tarjetas arriba ("Mis captaciones" y "Mis
          tareas") y debajo una rejilla con UNA TARJETA POR CADA VALOR del
          catálogo `fuente`, cinco de ellas a cero. Las dos de arriba no se han
          perdido: son la de scraper —sus captaciones— y la del calendario, que
          ahora están DENTRO de las seis. Dejarlas también arriba sería contar
          lo mismo dos veces a dos centímetros.

          MISMO COMPONENTE Y MISMA REJILLA que la portada del administrador
          (`grid-cols-2 lg:grid-cols-3`): seis tarjetas son dos filas de tres
          exactas, sin huecos que rellenar.

          SIN SELECTOR DE PERIODO Y SIN BARRAS, que es la única diferencia con
          la de él y es a propósito. El administrador mueve miles de leads y sus
          catorce barras contestan a "¿este canal sigue vivo?"; un agente mueve
          dos leads por semana, y catorce barras casi planas no dicen nada —
          dicen que no trabaja. Además tres de estas seis no tienen barras
          posibles: el calendario mira hacia delante, las demandas son de la
          empresa y matches todavía no existe. Así que las seis enseñan el
          MISMO tipo de número —lo acumulado— y lo de esta semana va en palabras
          en la línea de abajo, que es donde se lee sin interpretar un dibujo. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
          De un vistazo
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Una familia de valores por tarjeta, no un valor: Instagram y
              Facebook son la misma pregunta. El enlace va a /leads sin filtro
              justamente por eso —`?fuente=` sólo admite UN valor del catálogo—. */}
          <OrigenCard
            href="/leads" icon={Share2} label="Redes sociales"
            datos={data.canales.rrss.total ?? 0}
            fallo={data.canales.rrss.total == null}
            tono="rosa"
            extra={textoCanal(data.canales.rrss, "todavía no te han repartido ninguno")}
          />
          <OrigenCard
            href="/leads" icon={Globe} label="Web"
            datos={data.canales.web.total ?? 0}
            fallo={data.canales.web.total == null}
            tono="cyan"
            extra={textoCanal(data.canales.web, "todavía no te han repartido ninguno")}
          />
          {/* SUS CAPTACIONES, no "el scraper con señal" del administrador. Es
              el cambio que pidió el dueño: al agente no le sirve saber cuánta
              gente ha dicho que sí en toda la empresa, le sirve saber cuántas
              fichas suyas tiene que trabajar. Se llama "Scraper" porque es de
              donde salen y porque así la nombra él. */}
          <OrigenCard
            href="/captaciones" icon={Radar} label="Scraper · mis captaciones"
            datos={data.captaciones ?? 0}
            fallo={data.captaciones == null}
            tono="violeta"
            extra={
              data.captaciones === 0
                ? "todavía no te han asignado ninguna"
                : data.captacionesEsteMes == null
                  ? "— este mes"
                  : data.captacionesEsteMes > 0
                    ? `${data.captacionesEsteMes} este mes`
                    : "ninguna nueva este mes"
            }
          />
          {/* LAS DEMANDAS SON DE LA EMPRESA Y LA TARJETA LO DICE SIEMPRE.
              La tabla `demandas` no tiene columna de agente —una demanda es de
              un piso, no de una persona—, así que este número es idéntico para
              los seis agentes. El aviso va en la línea de abajo y no sólo en la
              etiqueta a propósito: la etiqueta se corta con puntos suspensivos
              en el móvil (dos tarjetas por fila) y la línea de abajo se parte en
              dos, que es lo que se quiere cuando lo que no puede perderse es
              justo esa advertencia. */}
          <OrigenCard
            href="/demandas" icon={Inbox} label="Demandas"
            datos={data.demandasEmpresa.total ?? 0}
            fallo={data.demandasEmpresa.total == null}
            tono="verde"
            extra={
              data.demandasEmpresa.total === 0
                ? "de toda la empresa · todavía no ha entrado ninguna"
                : data.demandasEmpresa.sinVer == null
                  // El "—" y no callarse: el contador de las que faltan por ver
                  // ha fallado, y "todas vistas" sería inventárselo.
                  ? "de toda la empresa · — sin ver"
                  : data.demandasEmpresa.sinVer > 0
                    ? `de toda la empresa · ${data.demandasEmpresa.sinVer} sin ver`
                    : "de toda la empresa · todas vistas"
            }
          />
          {/* EL CALENDARIO. El número es lo ACCIONABLE —lo vencido más lo de
              hoy—, que es la misma cuenta que hacía la tarjeta "Mis tareas" que
              acaba de desaparecer de arriba: ni el total histórico, que a los
              seis meses son cientos de tareas hechas, ni sólo las de hoy,
              porque una tarea de ayer sin hacer sigue siendo trabajo de hoy. */}
          <OrigenCard
            href="/calendario" icon={CalendarDays} label="Mi calendario"
            datos={tareasAhora ?? 0}
            fallo={tareasAhora == null}
            tono="ambar"
            extra={subTareas}
          />
          {/* La tabla `matches` NO EXISTE todavía. `datos` a null es "en
              desarrollo", que es una tercera cosa distinta de un cero y de un
              fallo. Exactamente lo mismo que hace la portada del
              administrador: aquí no se inventa un número. */}
          <OrigenCard
            href="/matches" icon={Heart} label="Matches"
            datos={null}
            tono="granate"
          />
        </div>
      </section>

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
          // El catálogo ya está aquí para el resto de la pantalla, así que el
          // desplegable de tipos sale de él: es lo que hace que "Visita" se
          // pueda elegir desde la portada sin lista escrita en el código.
          catalogos={catalogos}
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

/**
 * La línea de debajo del número en las dos tarjetas de canal.
 *
 * Es palabra por palabra la que tenían las tarjetas por fuente que había aquí
 * antes, y se conserva porque distingue las tres cosas que esta portada no
 * puede confundir: un canal vacío ("todavía no te han repartido ninguno"), una
 * semana medida y a cero ("nada nuevo esta semana") y una semana que NO se ha
 * podido contar ("— esta semana"). Un espacio en blanco se colapsaría dentro
 * del <p> y el fallo se leería igual que el cero.
 *
 * El total roto no llega hasta aquí: esa tarjeta se pinta entera como fallo.
 */
function textoCanal(canal: { total: number | null; semana: number | null }, vacio: string) {
  if (canal.total === 0) return vacio
  if (canal.semana == null) return "— esta semana"
  return canal.semana > 0 ? `${canal.semana} esta semana` : "nada nuevo esta semana"
}

/*
  AQUÍ ESTABAN `KpiCard`, `SeccionOrigenes`, `TarjetaFuente`, `TarjetaVisita`,
  `ICONO_FUENTE`, `FUENTE_SIN_TARJETA` y el tipo `Origen`, y se han ido enteros
  con el cambio que dejó la portada en seis tarjetas.

  Lo que pintaban: la fila de dos KPIs de arriba y una rejilla con una tarjeta
  por cada valor del catálogo `fuente` —siete, cinco de ellas a cero— más la de
  "Visita por programar" intercalada. Las dos preguntas que de verdad
  contestaban siguen en pantalla: "Mis captaciones" es ahora la tarjeta del
  scraper y "Mis tareas", la del calendario.

  Lo que se pierde a sabiendas: la tarjeta "Visita por programar" (a quién le
  falta día) y el desglose lead a lead de las fuentes menores —QR, valoración,
  trasteros—, que quedan fuera de las familias `rrss` y `web`. El dueño ha
  pedido SEIS tarjetas y ha nombrado las seis; quien las quiera de vuelta tiene
  que decidir cuál de las seis se va.
*/
