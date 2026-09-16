"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Building2, UserCircle, CalendarClock, CalendarDays,
  Phone, AlertTriangle, Home, Target, Radar, Share2, Globe, Inbox, Heart,
} from "lucide-react"
import { AgendaPanel } from "@/components/agenda/agenda-panel"
import type { EntradaAgenda, PersonaAgenda } from "@/lib/agenda"
import { cn } from "@/lib/utils"
import { nombreDe, colorDe, claseColor, clasePunto, type Catalogo } from "@/lib/catalogos"
// LA MISMA TARJETA QUE PINTA EL ADMINISTRADOR, y desde ahora también su mismo
// selector de periodo. Vivía dentro de `AdminDashboard.tsx` y se sacó a un
// fichero compartido para poder enseñarle al agente sus seis, que son las seis
// de él; los cuatro botones salen de la misma lista `PERIODOS` para que "7 días"
// signifique lo mismo en las dos pantallas.
import { OrigenCard, PERIODOS, type ClavePeriodo, type Periodos } from "@/components/dashboard/origen-card"

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
  /**
   * A dónde lleva la fila: a su pantalla CON SU FICHA ABIERTA, no a la lista a
   * secas. Hasta hoy era un `href` fijo por ámbito, y eso dejaba al agente
   * buscando a mano en /captaciones el nombre que acababa de leer, entre 759.
   *
   * `null` es "esta fila no enlaza a ninguna parte": un enlace que lleva a
   * /sin-acceso es peor que ninguno.
   */
  enlace: (id: string) => string | null
  icono: React.ElementType
  chip: string
}> = {
  captacion: {
    etiqueta: "Captación", catalogo: "estado_whatsapp", icono: Building2,
    // El id de una captación es un número; /captaciones lo valida como tal y
    // abre su ficha, que se trae sola de la base: no hace falta que la fila
    // esté en la página que se ve.
    enlace: (id) => `/captaciones?id=${encodeURIComponent(id)}`,
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20",
  },
  prospecto: {
    etiqueta: "Prospecto", catalogo: "estado_prospecto", icono: Home,
    // /prospectos no sabe abrir una ficha concreta —no es pantalla de este
    // encargo—, así que lleva a la lista, igual que antes. Y sólo se pinta si
    // el agente tiene el módulo: ver `FilaDelDia`.
    enlace: () => "/prospectos",
    chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border-cyan-500/20",
  },
  lead: {
    etiqueta: "Lead", catalogo: "estado_lead", icono: Target,
    enlace: (id) => `/leads?lead=${encodeURIComponent(id)}`,
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  },
}

// Un ámbito que no es ninguno de los tres de la vista no puede tener ficha que
// abrir: no se sabe ni en qué tabla mirar.
//
// ARREGLADO EN REVISIÓN: aquí ponía que el enlace viejo llevaba "a /contactos,
// que no existe", y esa ruta SÍ existe — es la pantalla "En desarrollo" de la
// ficha única de cada persona. El enlace se quita igual, y por un motivo que
// además es cierto: mandaba a un marcador de posición que no enseña la fila que
// se acaba de pulsar. Un porqué falso es lo que hace que el siguiente lo
// "arregle" de vuelta.
const AMBITO_DESCONOCIDO = {
  etiqueta: "Contacto", catalogo: "estado_lead", enlace: () => null, icono: UserCircle,
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
  /**
   * El id en SU tabla, tal y como lo devuelve la vista: texto, porque una misma
   * columna tiene que valer para el número de una captación y para la uuid de
   * un lead. Es lo que hace que la fila lleve a su ficha y no a la lista.
   */
  id: string
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
  /**
   * Sus captaciones activas, contadas en la base.
   *
   * ARREGLADO EN REVISIÓN: aquí ponía que la tarjeta 'Scraper · mis
   * captaciones' saca su total "de ahí", y no es cierto desde que esa tarjeta
   * responde al selector de periodo: lo que lee es `origenes.scraper.total`.
   * Es EL MISMO count —`capsActivas` alimenta los dos campos en `getAgentData`,
   * a propósito, para que el número no pueda decir dos cosas— pero esta pieza
   * del contrato no la mira hoy ninguna pantalla.
   *
   * Se deja en pie porque el dueño pidió expresamente que el contador de
   * captaciones NO se fuera al quitar los dos embudos, y porque no cuesta un
   * viaje de más: la consulta hace falta igual para la tarjeta. Quien venga a
   * borrarla que borre el CAMPO y no la consulta, o la tarjeta del scraper se
   * queda sin total.
   */
  captaciones: number | null
  /**
   * LOS VALORES DE `fuente` DE CADA TARJETA DE LEADS.
   *
   * No es adorno ni configuración: es lo que el enlace de la tarjeta le pasa a
   * /leads para que la lista enseñe LOS MISMOS leads que acaba de contar el
   * número. Una tarjeta agrupa una FAMILIA (Instagram y Facebook son la misma
   * pregunta), así que son varios valores y no uno.
   */
  fuentes: { rrss: string[]; web: string[] }
  /**
   * Dónde empieza cada periodo corto, en ISO y calculado en el servidor con el
   * mismo corte que ha troceado las filas.
   *
   * Es la otra mitad del enlace: con "Hoy" puesto, la tarjeta dice 3 y la lista
   * de destino tiene que enseñar esos 3 y no los 121 de siempre.
   */
  cortes: { hoy: string; semana: string; mes: string }
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
   * LAS CUATRO TARJETAS QUE RESPONDEN AL SELECTOR DE PERIODO.
   *
   * Cada una trae sus cuatro números —hoy, 7 días, 30 días y el total— y los
   * catorce días de las barras, calculados en el servidor de una pasada: pulsar
   * "7 días" no consulta nada, y por eso el cambio es instantáneo.
   *
   * No hay una entrada por cada valor del catálogo `fuente`: los nombres los
   * escriben workflows distintos y no hay CHECK que los sujete, así que cada
   * tarjeta agrupa una FAMILIA de valores (page.tsx) y no un valor suelto —
   * Instagram y Facebook son la misma tarjeta—.
   *
   * `null` significa "no se ha podido contar" y NUNCA cero: la tarjeta se pinta
   * entera en ámbar. No es tampoco "en desarrollo", que es lo que dice un
   * `datos={null}` suelto — de distinguirlas se encarga `fallo`, que manda sobre
   * `datos` en la tarjeta.
   *
   * LAS DEMANDAS SON DE LA EMPRESA Y NO SUYAS: la tabla no tiene columna de
   * agente —una demanda es de un PISO, no de una persona—, así que ese número es
   * idéntico para los seis agentes y para el administrador, y la tarjeta tiene
   * que decirlo con palabras. `sinVer` viaja pegado a los periodos porque lo
   * pinta la misma tarjeta, y puede fallar por su cuenta sin tumbarla.
   */
  origenes: {
    rrss: Periodos | null
    web: Periodos | null
    scraper: Periodos | null
    demandas: (Periodos & { sinVer: number | null }) | null
  }
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

export default function AgentDashboard({ nombre, saludo, data, catalogos, agendaEquipo, yoId, puedeProspectos }: {
  nombre: string
  saludo: string
  data: AgentData
  catalogos: Catalogo[]
  agendaEquipo: { entradas: EntradaAgenda[]; personas: PersonaAgenda[]; disponible: boolean }
  yoId: string
  /**
   * Si este agente tiene abierto el módulo de prospectos. Lo decide el servidor
   * con sus permisos de verdad, no esta pantalla: aquí sólo se usa para no
   * pintar un enlace que acabaría en /sin-acceso.
   */
  puedeProspectos: boolean
}) {
  /**
   * EL AGENTE ARRANCA EN "TODO", NO EN "HOY" COMO EL ADMINISTRADOR.
   *
   * Son la misma lista de botones y la misma frase, pero no el mismo arranque, y
   * es por el volumen: el administrador ve entrar leads de seis agentes y su
   * "Hoy" casi nunca es cero, así que abrirle la portada en el día es abrirle lo
   * que está pasando ahora. Un agente mueve dos o tres leads por semana —el de
   * pruebas tiene 3 de Instagram, 3 de web y 1 captación—, o sea que su "Hoy" es
   * cero la mayoría de los días POR DISEÑO, no por avería. Cuatro ceros nada más
   * abrir el CRM no se leen como "hoy todavía no ha entrado nada": se leen como
   * que la pantalla está rota.
   *
   * Arrancando en "Todo" ve lo que tiene, que es lo que un comercial quiere
   * saber al sentarse, y el día sigue estando a un clic. Y lo de "¿ha entrado
   * algo últimamente?" ya lo contestan las catorce barras de cada tarjeta, que
   * se pintan mire uno el periodo que mire.
   */
  const [periodo, setPeriodo] = useState<ClavePeriodo>("total")

  /**
   * EL ENLACE DE UNA TARJETA DE LEADS, con lo que hace falta para que la lista
   * de destino enseñe lo mismo que el número.
   *
   * Dos cosas: la FAMILIA de fuentes (`?fuente=Instagram,Facebook,…`, que
   * /leads valida una a una contra el catálogo y pinta como chapa quitable) y,
   * si hay un periodo corto puesto, el CORTE de ese periodo (`&desde=…`). Sin
   * el corte, pulsar una tarjeta que dice 3 con "Hoy" abría una lista de 121:
   * el número prometiendo una cosa y la pantalla enseñando otra.
   *
   * `periodo` es el del botón pulsado ahora mismo, así que el enlace cambia con
   * él. El instante viene calculado del servidor (`data.cortes`) y no de
   * Date.now() aquí: durante el render, el servidor y el navegador escribirían
   * dos enlaces distintos y eso es un desajuste de hidratación.
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
  const detalleTareas =
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

  // Y LA CUESTIÓN DEL PERIODO, DICHA EN LA PROPIA TARJETA.
  //
  // El calendario es la única de las seis que tiene un número y no se mueve al
  // cambiar de periodo, y sin decirlo eso se lee como que está rota. No es que
  // no sepa contar hacia atrás: es que mira hacia DELANTE. "Cuántas tareas me
  // entraron hoy" no es una pregunta que se haga nadie; la pregunta es "qué
  // tengo que despachar", y eso no depende de si arriba pone 7 días o 30.
  //
  // Va siempre y no sólo cuando hay un periodo corto elegido: la frase de
  // encima habla de fechas de entrada también en "Todo", así que la advertencia
  // vale igual. Y va al final porque lo primero que se quiere leer es el
  // desglose del número.
  const subTareas = detalleTareas && `${detalleTareas} · al margen del periodo`

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
              {primeras.map((f) => (
                <FilaDelDia key={f.clave} fila={f} catalogos={catalogos} puedeProspectos={puedeProspectos} />
              ))}
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
                  {resto.map((f) => (
                    <FilaDelDia key={f.clave} fila={f} catalogos={catalogos} puedeProspectos={puedeProspectos} />
                  ))}
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

          Y EL MISMO SELECTOR DE PERIODO, que lo pidió el dueño después: los
          mismos cuatro botones, la misma frase encima y los mismos cuatro
          números por tarjeta. Aquí decía que el agente iba SIN selector y sin
          barras porque un agente mueve dos leads por semana y catorce barras
          casi planas no dicen nada; lo que se ha visto es que sin ellas la
          tarjeta tampoco decía si el canal sigue vivo, y con el selector puesto
          las barras son además lo que salva un "Hoy" a cero de parecer una
          avería. Lo que sí se mantiene es que no todas responden: DOS de las
          seis lo ignoran a propósito —el calendario mira hacia delante y
          matches todavía no existe— y las dos lo dicen en su línea de abajo en
          vez de quedarse quietas sin explicar por qué. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              De un vistazo
            </h2>
            <p className="text-xs text-muted-foreground">
              {PERIODOS.find((p) => p.valor === periodo)!.frase}
            </p>
          </div>

          {/* El selector no consulta nada: los cuatro periodos y las barras
              vienen calculados del servidor, así que el cambio es instantáneo,
              sin consulta ni spinner. Mismos botones y mismo violeta que el del
              administrador, y salidos de la misma lista. */}
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

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Una familia de valores por tarjeta, no un valor: Instagram y
              Facebook son la misma pregunta. Y el enlace lleva la familia
              ENTERA: `?fuente=` admite desde hoy varios valores separados por
              comas, que es lo que hacía falta para que pulsar la tarjeta abra
              justo los leads que ha contado y no la lista de los 1.090.

              El `extra` sólo se escribe cuando el canal está a cero: con
              números, la línea de abajo la pone la tarjeta y dice "N en total",
              que es justo lo que hace falta al mirar un periodo corto —un cero
              en "Hoy" con "7 en total" debajo se lee como lo que es—. A cero se
              prefiere esta frase a la de la tarjeta ("Aún sin usar"), porque a
              un agente no le han faltado ganas: no le han repartido nada. */}
          <OrigenCard
            href={enlaceLeads(data.fuentes.rrss)} icon={Share2} label="Redes sociales"
            datos={data.origenes.rrss} periodo={periodo}
            fallo={data.origenes.rrss == null}
            tono="rosa"
            extra={data.origenes.rrss?.total === 0 ? "todavía no te han repartido ninguno" : undefined}
          />
          <OrigenCard
            href={enlaceLeads(data.fuentes.web)} icon={Globe} label="Web"
            datos={data.origenes.web} periodo={periodo}
            fallo={data.origenes.web == null}
            tono="cyan"
            extra={data.origenes.web?.total === 0 ? "todavía no te han repartido ninguno" : undefined}
          />
          {/* SUS CAPTACIONES, no "el scraper con señal" del administrador. Es
              el cambio que pidió el dueño: al agente no le sirve saber cuánta
              gente ha dicho que sí en toda la empresa, le sirve saber cuántas
              fichas suyas tiene que trabajar. Se llama "Scraper" porque es de
              donde salen y porque así la nombra él.

              EL ENLACE NO LLEVA EL CORTE DEL PERIODO, y es la única de las tres
              que no puede: la lista de /captaciones la trae una acción de
              servidor con tres filtros y ninguno es la fecha. En vez de
              callarlo, se le manda la PALABRA del periodo y esa pantalla lo
              dice en su cabecera ("vienes de tu portada mirando los últimos 7
              días · aquí salen todas"). Lo que no vale es que el número prometa
              tres y salgan 759 sin explicación; dicho, se entiende. */}
          <OrigenCard
            href={periodo === "total" ? "/captaciones" : `/captaciones?periodo=${periodo}`}
            icon={Radar} label="Scraper · mis captaciones"
            datos={data.origenes.scraper} periodo={periodo}
            fallo={data.origenes.scraper == null}
            tono="violeta"
            extra={data.origenes.scraper?.total === 0 ? "todavía no te han asignado ninguna" : undefined}
          />
          {/* LAS DEMANDAS SON DE LA EMPRESA Y LA TARJETA LO DICE SIEMPRE.
              La tabla `demandas` no tiene columna de agente —una demanda es de
              un piso, no de una persona—, así que este número es idéntico para
              los seis agentes. El aviso va en la línea de abajo y no sólo en la
              etiqueta a propósito: la etiqueta comparte sitio con el icono y se
              corta con puntos suspensivos en cuanto la ventana se estrecha (dos
              tarjetas por fila), mientras que la línea de abajo tiene el ancho
              entero de la tarjeta y se parte en dos, que es lo que se quiere
              cuando lo que no puede perderse es justo esa advertencia. */}
          <OrigenCard
            href="/demandas" icon={Inbox} label="Demandas"
            datos={data.origenes.demandas} periodo={periodo}
            fallo={data.origenes.demandas == null}
            tono="verde"
            extra={textoDemandas(data.origenes.demandas, periodo)}
          />
          {/* EL CALENDARIO. El número es lo ACCIONABLE —lo vencido más lo de
              hoy—, que es la misma cuenta que hacía la tarjeta "Mis tareas" que
              acaba de desaparecer de arriba: ni el total histórico, que a los
              seis meses son cientos de tareas hechas, ni sólo las de hoy,
              porque una tarea de ayer sin hacer sigue siendo trabajo de hoy.

              NO RECIBE `periodo` Y ES A PROPÓSITO: manda un contador suelto
              (`number`), que es la forma con la que la tarjeta no pinta ni
              periodo ni barras. No sabría qué hacer con él —mira hacia delante,
              no hacia atrás— y por eso su línea de abajo lo dice con palabras
              en vez de quedarse quieta como si se hubiera colgado. */}
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

      {/*
        AQUÍ ESTABAN "ESTADO WHATSAPP · MIS CAPTACIONES" Y "MI PIPELINE DE
        LEADS", los dos embudos del final, y los ha quitado el dueño.

        Cada uno era una barra apilada con su leyenda, y con lo que tiene un
        agente de verdad no decían nada: con UNA captación, la barra entera era
        un solo tramo ("Enviado 1"); con cuatro leads, "Nuevo 1 · Contactado 3"
        y cinco ceros al lado. Un embudo hace falta cuando hay volumen que
        repartir; con estos números es un adorno que ocupa media pantalla justo
        debajo de lo único accionable.

        Se han ido con ellos sus consultas —el desglose por estado de WhatsApp,
        el contador de las captaciones sin escribir y la decena de contadores del
        pipeline, uno por estado del catálogo—: ver `getAgentData` en page.tsx.
        Lo que NO se ha ido es el count de captaciones activas, que es el total
        de la tarjeta 'Scraper · mis captaciones'.

        Lo que se pierde a sabiendas: por dónde va cada lead suyo y cuántos
        WhatsApp esperan respuesta. Las dos cosas están, una pulsación más
        allá, en /leads y /captaciones — que es a donde llevan ya las tarjetas
        de arriba, y ahora además filtradas.
      */}

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
        para el archivo—.

        ARREGLADO EN REVISIÓN: este párrafo terminaba diciendo que los Ganados
        "se siguen viendo en el pipeline de aquí al lado". Ese pipeline lo ha
        quitado el dueño en este mismo cambio, así que la frase mandaba a
        buscar un bloque que ya no existe. Hoy los Ganados están en /leads,
        filtrando por su estado.
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
function FilaDelDia({ fila, catalogos, puedeProspectos }: {
  fila: FilaDia
  catalogos: Catalogo[]
  puedeProspectos: boolean
}) {
  const meta = AMBITOS[fila.ambito] ?? AMBITO_DESCONOCIDO
  const Icono = meta.icono

  /**
   * A DÓNDE LLEVA EL NOMBRE DE LA FILA.
   *
   * A su ficha, abierta: `/captaciones?id=…` y `/leads?lead=…`. Antes llevaba a
   * la lista a secas y había que buscar el nombre a mano entre 759 captaciones
   * o 1.090 leads, que es tanto como no llevar a ninguna parte.
   *
   * El prospecto es la excepción: /prospectos va cerrado por defecto para los
   * agentes (PERMISOS_DEFAULT), así que sin el módulo el enlace sólo llevaría a
   * /sin-acceso. Sin enlace, el nombre se queda en texto y la fila sigue
   * diciendo lo que importa —a quién llamar y su teléfono—, que es a lo que se
   * viene. Y quien SÍ tenga el módulo lo conserva.
   */
  const destino = fila.ambito === "prospecto" && !puedeProspectos ? null : meta.enlace(fila.id)

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
          {destino ? (
            <Link href={destino} className="text-sm font-medium text-foreground truncate hover:underline">
              {fila.titulo}
            </Link>
          ) : (
            <span className="text-sm font-medium text-foreground truncate">{fila.titulo}</span>
          )}
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

              ARREGLADO EN REVISIÓN: aquí ponía que el punto de color repetía la
              pareja punto+texto de "las leyendas del pipeline y de WhatsApp de
              esta misma pantalla", y esas dos leyendas se han ido en este mismo
              cambio. La pareja sigue siendo la misma que usan las pastillas de
              /leads y las chapas de sus filtros, así que el color de Instagram
              sigue significando Instagram en los dos sitios. Y va PRIMERO de
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
 * La línea de debajo del número en la tarjeta de DEMANDAS.
 *
 * Dice siempre "de toda la empresa", y por eso esta tarjeta es la única de las
 * cuatro con periodo que se escribe su línea entera en vez de dejar que la
 * tarjeta ponga "N en total". La tabla `demandas` no tiene columna de agente
 * —una demanda es de un PISO, no de una persona—, así que el número es idéntico
 * para los seis agentes, y el aviso va aquí abajo y no sólo en la etiqueta a
 * propósito: la etiqueta comparte sitio con el icono y se corta con puntos
 * suspensivos en cuanto la ventana se estrecha (dos tarjetas por fila),
 * mientras que esta línea tiene el ancho entero de la tarjeta y se parte en
 * dos. Que se parta de verdad y no se recorte por el lado derecho depende del
 * `min-w-0` de la columna del número en `origen-card.tsx`, que iba con
 * `shrink-0` y se arregló en revisión: es lo que le permite a esta línea
 * llevar tres trozos.
 *
 * Distingue además las tres cosas que esta portada no puede confundir: ninguna
 * demanda todavía, unas cuantas sin ver, y un contador de "sin ver" que ha
 * fallado ("— sin ver"), que NO es "todas vistas". El total roto no llega hasta
 * aquí: esa tarjeta se pinta entera como fallo.
 *
 * AQUÍ ESTABA `textoCanal`, la línea de las tarjetas de redes y web. Se va con
 * el selector: lo que decía —cuántos de esta semana— es ahora uno de los cuatro
 * botones, y lo que hacía falta debajo del número (el total, para que un cero en
 * "Hoy" se entienda) lo pone ya la propia tarjeta.
 *
 * ARREGLADO EN REVISIÓN: y justo por eso esta línea tiene que escribirse también
 * el total. Al mandar un `extra`, la tarjeta deja de poner el suyo ("N en
 * total"), así que con un periodo corto elegido ésta era la ÚNICA de las cuatro
 * que enseñaba un número pelado: "0" bajo "Hoy" con "de toda la empresa · 43 sin
 * ver" debajo y ni rastro de las 1.825 que hay. Un cero sin su total al lado es
 * exactamente lo que esta portada no puede permitirse —se lee como avería, no
 * como que hoy no ha entrado nada—, y las otras tres de la misma fila sí lo
 * dicen. En "Todo" no se repite: ahí el número grande YA es el total.
 */
function textoDemandas(
  d: (Periodos & { sinVer: number | null }) | null,
  periodo: ClavePeriodo,
) {
  // Un total roto no llega aquí: la tarjeta se pinta entera en ámbar.
  if (d == null) return undefined
  if (d.total === 0) return "de toda la empresa · todavía no ha entrado ninguna"
  // Se arma como lista y se une con " · " en vez de encadenar trozos con el
  // separador pegado delante, por lo mismo que la cabecera de "Lo que toca hoy":
  // el trozo del medio es opcional y concatenando se quedaban dos puntos
  // seguidos el día que no toca escribirlo.
  return [
    "de toda la empresa",
    periodo !== "total" ? `${d.total.toLocaleString("es")} en total` : null,
    // Las tres cosas que no se pueden confundir: un contador de "sin ver" roto
    // ("— sin ver") NO es "todas vistas", y ninguno de los dos es un cero.
    d.sinVer == null
      ? "— sin ver"
      : d.sinVer > 0
        ? `${d.sinVer.toLocaleString("es")} sin ver`
        : "todas vistas",
  ].filter((t): t is string => t != null).join(" · ")
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
