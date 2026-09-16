import { createClient, createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import AdminDashboard, { type AdminData } from "./AdminDashboard"
import AgentDashboard, { type AgentData, type FilaDia } from "./AgentDashboard"
import { getAgendaMes } from "@/lib/actions/agenda"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { opcionesDe, nombreDe, colorDe, type Catalogo } from "@/lib/catalogos"
// Los permisos del que mira deciden si la fila de un PROSPECTO enlaza a alguna
// parte: el módulo va cerrado por defecto para los agentes y un enlace que sólo
// lleva a /sin-acceso es peor que no tener enlace.
import { resolverPermisos } from "@/types/database"
import { traerTodo } from "@/lib/supabase/paginar"
// El tipo de los cuatro periodos + las barras. Lo pintan LAS DOS portadas, así
// que las dos funciones de esta página lo devuelven.
import type { Periodos } from "@/components/dashboard/origen-card"

export const metadata = { title: "Inicio — mkgenia" }

/**
 * Cuántas filas de "lo que toca hoy" se traen.
 *
 * La lista es para saber a quién llamar ahora, no un listado: pasadas cuarenta
 * ya nadie baja. El número REAL de pendientes no sale de contar estas filas
 * —eso diría 40 pase lo que pase— sino de un count exacto contra la vista.
 */
const TOPE_DIA = 40

/**
 * LAS FAMILIAS DE `fuente`, que usan LAS DOS portadas.
 *
 * Los nombres de `fuente` los escriben workflows distintos y no hay CHECK que
 * los sujete, así que se agrupan por familias y no por igualdad exacta: hoy
 * conviven 'Captaciones', 'Web' y 'Propiedades', y mañana aparecerá otro.
 *
 * Estaba declarada dentro de `getAdminData` y se sube aquí porque la portada
 * del agente pinta ahora dos de estas familias —redes sociales y web— y tienen
 * que ser LAS MISMAS que las del administrador: dos listas separadas se van
 * separando sin que nadie se entere, y el día que alguien añada 'TikTok' a una
 * de las dos, los dos números de la misma persona dejan de cuadrar sin que nada
 * falle.
 */
const FAMILIAS_FUENTE: Record<string, string[]> = {
  web: ["Web", "Propiedades", "Formulario", "Landing"],
  scraper: ["Captaciones", "Captacion", "Captación"],
  rrss: ["Instagram", "Facebook", "RRSS", "Redes"],
  qr: ["QR", "Galeria QR", "Trasteros WhatsApp"],
}

/**
 * Fechas y relativos SE CALCULAN AQUÍ, en el servidor, no en el componente.
 *
 * "hace 3 h" sale de Date.now(). El servidor pinta en UTC y el navegador hidrata
 * minutos después en Madrid: si el texto se calculara durante el render, los dos
 * lados escribirían cosas distintas y React lo cantaría como desajuste de
 * hidratación. Calculado aquí viaja ya hecho, y el cliente sólo lo pinta.
 */
function desdeHace(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null

  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 2) return "hace un momento"
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias < 31) return `hace ${dias} ${dias === 1 ? "día" : "días"}`
  const meses = Math.floor(dias / 30)
  return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`
}

/** Fecha corta y fija (zona de Madrid) para lo que todavía no ha vencido. */
const FECHA_CORTA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
})

function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  return FECHA_CORTA.format(ms)
}

/**
 * Las piezas de una fecha vistas desde MADRID. Sólo la usa `inicioDiaMadrid`.
 *
 * `en-CA` no es un capricho de idioma: se leen las piezas una a una con
 * `formatToParts`, así que el idioma no pinta nada y lo único que importa es
 * que el formato pida las siete piezas en 24 horas.
 */
const PARTES_MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

/**
 * El instante en que empieza (00:00 de MADRID) el día de `base`, o el de
 * `sumaDias` días después.
 *
 * NO vale cortar el día con `new Date(...); setHours(0,0,0,0)`, que es la hora
 * del SERVIDOR. En producción el servidor va en UTC y Madrid va una o dos horas
 * por delante, y eso rompe justo el caso más común de la agenda: una entrada de
 * "todo el día" la crea el navegador como `new Date("2026-09-16T00:00:00")` con
 * la hora de Madrid (agenda-panel.tsx:330), o sea que se guarda como
 * 2026-09-15T22:00Z. Cortando el día en la medianoche de UTC, esa tarea de
 * mañana cae en el saco de ayer y la tarjeta la cantaría como VENCIDA un día
 * entero antes de tiempo, que es exactamente la mentira que esta pantalla no se
 * puede permitir.
 *
 * El desfase se mide en `base` y se aplica también a los días que se le suman:
 * en la madrugada de los dos cambios de hora al año el corte puede irse una
 * hora. Es el único caso, y se prefiere a no mirar la zona en absoluto.
 */
function inicioDiaMadrid(base: Date, sumaDias = 0): Date {
  const p: Record<string, string> = {}
  for (const parte of PARTES_MADRID.formatToParts(base)) p[parte.type] = parte.value
  // Con `hour12: false` algunas versiones de Node escriben la medianoche como
  // "24" en vez de "00"; sin esto el desfase saldría 24 h torcido esa hora.
  const hora = p.hour === "24" ? "00" : p.hour
  // El mismo reloj leído como si fuera UTC. No es una fecha de verdad: sólo
  // sirve para restar y saber cuánto va Madrid por delante de UTC ahora mismo.
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hora, +p.minute, +p.second)
  const desfase = comoUTC - base.getTime()
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + sumaDias) - desfase)
}

/**
 * Un contador que falla vale `null`, nunca 0.
 *
 * Un 0 se lee como "no tienes nada pendiente" y es justo la mentira que no nos
 * podemos permitir en la pantalla que el agente abre por la mañana.
 */
const cuenta = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0)

/**
 * Cuántos días de barras lleva una tarjeta. Catorce: es lo que convierte un
 * número suelto en algo que se puede leer —42 no dice nada, 42 después de
 * catorce días planos sí— y es lo que cabe en el ancho de la tarjeta.
 */
const DIAS_SERIE = 14

/**
 * Las barras: una por día, de la más vieja a la de hoy.
 *
 * OJO, y se deja escrito a sabiendas: estos cubos parten el día por la
 * medianoche de UTC —la fecha del propio texto ISO, recortado a diez letras—
 * mientras que el número grande lo parte por la de MADRID (ver `porPeriodo`).
 * O sea que un lead entrado a las 00:30 de Madrid cuenta en "Hoy" y su barra
 * cae en la columna de ayer. Es una o dos horas al día sobre una franja de
 * catorce columnas y no se toca porque cuadrarlo movería barras en la portada
 * del ADMINISTRADOR, que no cambia en este encargo; el número, que es el que
 * se lee, sí tenía que quedar bien. Quien venga a unificarlo tiene que hacerlo
 * en las dos portadas a la vez: las dos pintan estas mismas barras.
 */
function serieDe(filas: Array<{ fecha_creacion?: string | null }>) {
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

/**
 * LOS CUATRO PERIODOS Y LAS BARRAS DE UNA TANDA DE FILAS.
 *
 * Vivía dentro de `getAdminData` y sube aquí porque la portada del agente monta
 * ahora el MISMO selector. Dos copias de esta cuenta se van separando sin que
 * nadie se entere, y el día que alguien mueva el corte de "hoy" en una de las
 * dos, el mismo lead contaría distinto en la pantalla del jefe y en la del
 * comercial sin que nada falle.
 *
 * Los cortes se calculan EN CADA LLAMADA y no en una constante de módulo: el
 * proceso de Node vive días enteros entre despliegues, y una constante evaluada
 * al cargar el fichero dejaría "hoy" congelado en el día en que arrancó.
 *
 * `total` es `filas.length`, así que quien no se traiga TODAS las filas —el
 * agente sólo se trae la ventana de 30 días— tiene que pisarlo con su propio
 * count exacto.
 */
/**
 * DÓNDE EMPIEZA CADA PERIODO CORTO, en milisegundos.
 *
 * Se saca aparte porque ahora lo miran DOS sitios: la cuenta de las tarjetas
 * (`porPeriodo`, aquí debajo) y el enlace de esas mismas tarjetas, que desde
 * este cambio lleva el corte a /leads para que la lista enseñe exactamente los
 * que promete el número. Escrito dos veces, el día que alguien mueva el corte de
 * "hoy" la tarjeta diría 3 y la lista enseñaría 4, y nada fallaría.
 *
 * "Todo" no está: no tiene corte, que es justo lo que lo distingue de los otros
 * tres.
 */
function cortesPeriodo(ahora: Date) {
  return {
    hoy: inicioDiaMadrid(ahora).getTime(),
    semana: ahora.getTime() - 7 * 24 * 60 * 60 * 1000,
    mes: ahora.getTime() - 30 * 24 * 60 * 60 * 1000,
  }
}

/**
 * `reloj` es el instante desde el que se mide, y se puede pasar de fuera.
 *
 * ARREGLADO EN REVISIÓN: esta función se leía SIEMPRE su propio `new Date()`, y
 * desde que la tarjeta del agente lleva su corte a /leads (`?desde=`) eso son
 * dos relojes distintos para el mismo número: el enlace se escribe con el
 * `ahora` del principio de `getAgentData` y la cuenta se hacía con el de
 * después de esperar a todas las consultas —medio segundo largo más tarde—. Con
 * "7 días" puesto, un lead entrado justo en esa rendija de hace siete días
 * contaba en la lista y no en la tarjeta: el número diciendo 3 y la pantalla
 * enseñando 4, que es exactamente lo que este encargo venía a quitar.
 *
 * El parámetro es OPCIONAL y cae a `new Date()`, así que la portada del
 * ADMINISTRADOR —que no lo pasa— cuenta hoy lo mismo que contaba ayer.
 */
function porPeriodo(filas: Array<{ fecha_creacion?: string | null }>, reloj?: Date): Periodos {
  const ahora = reloj ?? new Date()
  // El día empieza a las 00:00 de MADRID, no a las del servidor (ver
  // `inicioDiaMadrid`). En producción Node va en UTC y Madrid va una o dos horas
  // por delante.
  //
  // ARREGLADO EN REVISIÓN: aquí ponía que cortando por la medianoche del
  // servidor "Hoy" se tragaba las dos últimas horas de AYER, y es justo al
  // revés — el error contado al derecho es lo único que impide que alguien
  // "arregle" esto de vuelta. La medianoche de UTC son las 02:00 de Madrid, o
  // sea que el corte viejo empezaba el día dos horas TARDE y dejaba fuera de
  // "Hoy" todo lo entrado entre las 00:00 y las 02:00. Un lead de la
  // madrugada no aparecía hasta el día siguiente. Este corte lo recupera, así
  // que el "Hoy" del ADMINISTRADOR puede salir ahora un poco más alto que
  // antes: la diferencia son esas filas, que siempre fueron de hoy.
  const cortes = cortesPeriodo(ahora)
  // Se compara en MILISEGUNDOS, no en texto. PostgREST devuelve
  // "2026-09-15T08:30:00+00:00" y `toISOString()` escribe "…08:30:00.000Z": son
  // dos formatos distintos para la misma hora, y el orden alfabético de dos
  // formatos distintos no tiene por qué ser el orden del tiempo. Es la misma
  // trampa que ya documenta `vencidoSegun` más abajo.
  // Una fecha ilegible da NaN, y NaN no es mayor que nada: se queda fuera de los
  // tres periodos y dentro del total, que es donde de verdad está la fila.
  const ms = filas.map((f) => (f.fecha_creacion ? new Date(f.fecha_creacion).getTime() : NaN))
  const desde = (corte: number) => ms.filter((m) => m >= corte).length

  return {
    hoy: desde(cortes.hoy),
    semana: desde(cortes.semana),
    mes: desde(cortes.mes),
    total: filas.length,
    serie: serieDe(filas),
  }
}

async function getAdminData(catalogos: Catalogo[]): Promise<AdminData> {
  const supabase = await createAdminClient()
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Entra el catálogo entero y no una lista de estados ya masticada porque ahora
  // hacen falta dos listas: la del pipeline y la de la señal. Y la de la señal
  // es EDITABLE —el administrador puede añadir una tercera desde
  // /configuracion/catalogos—, así que no se puede escribir aquí.
  //
  // De las dos se coge la OPCIÓN entera y no sólo el `valor`: hace falta también
  // el nombre y el color para pintarlas. Escritos a mano en el componente, el
  // estado `test` que ya existe hoy en el catálogo salía en la leyenda del
  // pipeline sin nombre y con el punto transparente.
  const opcionesLead = opcionesDe(catalogos, "estado_lead")
  const senales = opcionesDe(catalogos, "senal_interes")

  // Los de la señal se cuentan EN LA BASE, con `head: true`: viajan los números
  // y no las filas. Sólo las activas, que es de lo que habla el resto del CRM.
  const conSenal = () =>
    supabase.from("captaciones").select("id", { count: "exact", head: true })
      .eq("activo", true).not("senal", "is", null)

  const [allLeads, allCaps, demandas, usuariosRes, recientesRes, capsHist, leadsHist, interesEventos,
    senalTotalRes, senalSinLlamarRes, senalPorValorRes] = await Promise.all([
    // `agente_id` además de `captado_por`: desde la 024 son dos personas
    // distintas —quién lo trajo y quién lo trabaja— y la tabla de rendimiento
    // mide al que lo trabaja hoy.
    traerTodo<{ id: string; estado: string; fecha_creacion: string; captado_por: string | null; agente_id: string | null; fuente: string | null }>(() =>
      supabase.from("leads").select("id, estado, fecha_creacion, captado_por, agente_id, fuente").order("fecha_creacion", { ascending: true })),
    // `senal` en vez de `estado_whatsapp`: desde la 027 el interés no es un
    // estado de la conversación sino una columna aparte. `estado_whatsapp` ya no
    // se lee en ningún sitio de esta función, así que tampoco se trae.
    traerTodo<{ id: number; activo: boolean; agente_id: string | null; senal: string | null }>(() =>
      supabase.from("captaciones").select("id, activo, agente_id, senal").order("created_at", { ascending: true })),
    traerTodo<{ id: string; estado: string; visto: boolean; fecha_creacion: string }>(() =>
      supabase.from("demandas").select("id, estado, visto, fecha_creacion").order("fecha_creacion", { ascending: true })),
    supabase.from("perfiles").select("id, nombre, apellidos, rol"),
    supabase.from("leads").select("id, nombre, apellidos, fuente, estado, fecha_creacion")
      .order("fecha_creacion", { ascending: false }).limit(6),
    // Las dos series de 30 días: paginadas, no a pelo.
    //
    // Estaban como un `select` suelto sin `range`, y eso es la trampa de siempre:
    // PostgREST corta en 1.000 filas con 200 OK y sin decir nada. El captador
    // crea captaciones a diario, así que un mes ya se pasa del tope: las barras
    // del final —los días más recientes, que son los que se miran— salían a cero
    // sin que nada avisara.
    traerTodo<{ created_at: string | null }>(() =>
      supabase.from("captaciones").select("created_at")
        .gte("created_at", hace30dias).order("created_at", { ascending: true })),
    traerTodo<{ fecha_creacion: string | null }>(() =>
      supabase.from("leads").select("fecha_creacion")
        .gte("fecha_creacion", hace30dias).order("fecha_creacion", { ascending: true })),
    // Cuándo se interesó cada propietario. El captador registra cada cambio en
    // `historial_cambios`, así que la fecha es la de verdad y no la de cuándo se
    // le escribió.
    //
    // Se miran DOS campos a la vez porque con la 027 el interés cambió de sitio:
    //
    //   · Las filas VIEJAS lo nombran como un estado de WhatsApp: campo
    //     'estado_whatsapp' con valor 'Interesado' o 'Quiere_Llamada'. Hoy son
    //     129 y se quedan. Sacarlas del filtro para "limpiar" dejaría la tarjeta
    //     sin nada anterior al 15/09: la historia no se migra, se lee.
    //
    //   · Las NUEVAS tienen que venir como campo 'senal' con un valor no nulo.
    //     Nulo es "se le borró la señal" —contestó que no—, que no es
    //     interesarse. No se nombra aquí ningún valor concreto a propósito: la
    //     lista de señales la edita el administrador y esta consulta las coge
    //     todas, incluida la que se invente mañana.
    //
    // Los dos `campo` son distintos, así que una misma fila no puede entrar por
    // las dos ramas: no hay nada que pueda contarse dos veces.
    traerTodo<{ fecha: string; captacion_id: number | null }>(() =>
      supabase.from("historial_cambios")
        .select("fecha, captacion_id")
        .or("and(campo.eq.estado_whatsapp,valor_nuevo.in.(Interesado,Quiere_Llamada))," +
            "and(campo.eq.senal,valor_nuevo.not.is.null)")
        .order("fecha", { ascending: true })),
    // Cuántos han levantado la mano.
    conSenal(),
    // Y de ésos, a cuántos no ha llamado NADIE todavía.
    //
    // `atendido_en` lo pone sola la base cada vez que se registra una
    // interacción (migración 021), así que un nulo aquí no es un olvido de
    // alguien: es que ese teléfono no ha sonado nunca. Es el número que de
    // verdad importa de esta pantalla, y hasta hoy no salía en ninguna parte.
    conSenal().is("atendido_en", null),
    // El desglose por señal, un contador diminuto por valor del catálogo.
    Promise.all(senales.map((sn) =>
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("activo", true).eq("senal", sn.valor))),
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

  // Interesados = los que tienen SEÑAL, no los que tienen cierto estado.
  //
  // Con la 027 `Interesado` y `Quiere_Llamada` dejaron de existir como estados
  // de WhatsApp —se fundieron en `Respondido`—, así que este filtro sobre
  // `estado_whatsapp` no encontraba ya ninguno: la tarjeta del scraper y la
  // tasa global se habrían quedado a cero de un día para otro.
  //
  // Y se cuenta sólo sobre las ACTIVAS, con el mismo filtro que los contadores
  // de `senal` de más abajo (`.eq("activo", true)`). Sin eso, la misma tarjeta
  // pinta en una línea "N con señal" contando también las dadas de baja y justo
  // debajo "N con señal en total" contando sólo las vivas: dos números
  // distintos para la misma frase en la misma pantalla. Hoy no se nota —las 757
  // captaciones están activas—, pero se notaría el día que se archive una.
  const capsActivas = allCaps.filter((c) => c.activo)
  const interesadosTotal = capsActivas.filter((c) => c.senal != null).length

  // De dónde entra cada lead. Las familias están arriba, en `FAMILIAS_FUENTE`,
  // porque la portada del agente pinta dos de ellas y tienen que ser las
  // mismas. Lo que no encaje en ninguna familia cae en "otros" en vez de
  // desaparecer de la suma.
  const conocidas = Object.values(FAMILIAS_FUENTE).flat()
  const otros = allLeads.filter((l) => !conocidas.includes(l.fuente ?? "")).length


  // Los cuatro periodos se calculan de una pasada aquí y viajan juntos al
  // cliente. Cuesta lo mismo que calcular uno —las filas ya están cargadas para
  // el pipeline— y a cambio cambiar de "hoy" a "30 días" es instantáneo, sin
  // consulta ni spinner. `porPeriodo` y `serieDe` están arriba, en el módulo:
  // la portada del agente hace ahora esta misma cuenta y tiene que ser LA MISMA.
  const familia = (fam: string) =>
    porPeriodo(allLeads.filter((l) => FAMILIAS_FUENTE[fam].includes(l.fuente ?? "")))

  // Un propietario cuenta UNA vez, el día que se interesó por primera vez.
  //
  // El historial guarda un evento por clasificación, y la escalada normal
  // —primero "me interesa" y luego "llamadme"— deja dos filas del mismo
  // teléfono: hoy son 129 eventos de 111 propietarios. Sin esto las barras
  // enseñarían más gente de la que hay y, peor, no cuadrarían con el número
  // grande de al lado, que son propietarios y no clasificaciones.
  //
  // Las filas vienen ordenadas de vieja a nueva, así que la que se queda es la
  // primera, que es la que responde a "cuándo se interesó".
  const yaContado = new Set<number>()
  const primerInteres = interesEventos.filter((e) => {
    // `historial_cambios` también guarda cambios de lead, y ésos llegan con
    // `captacion_id` a nulo. Sin esta salida todos los nulos se tomarían por el
    // mismo propietario y el primero se comería a los demás.
    if (e.captacion_id == null) return true
    if (yaContado.has(e.captacion_id)) return false
    yaContado.add(e.captacion_id)
    return true
  })

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
      // Los periodos y las barras salen de CUANDO se interesaron: la fecha del
      // historial, un propietario una vez. El total es cuantos tienen señal
      // AHORA, que es lo que enseña el resto del CRM: los que dijeron que si y
      // luego se cayeron no deben seguir sumando. Por eso los dos números no
      // tienen por qué cuadrar, y está bien que no cuadren.
      scraper: {
        ...porPeriodo(primerInteres.map((e) => ({ fecha_creacion: e.fecha }))),
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
    captacionesActivas: capsActivas.length,
    usuarios: todosPerfiles.length,
    interesadosTotal,
    // Numerador y denominador, las mismas filas: interesados sobre ACTIVAS. Con
    // `allCaps.length` abajo, cada captación archivada bajaba la tasa aunque no
    // pudiera haber contestado nunca.
    tasaGlobal: capsActivas.length > 0
      ? Math.round((interesadosTotal / capsActivas.length) * 100) : 0,
    // La señal del captador. Cada contador puede valer null por su cuenta: si
    // una de estas consultas falla se deja de pintar ESE número, no los otros.
    // Un 0 aquí se leería como "no hay nadie esperando", que es la mentira cara.
    senal: {
      total: cuenta(senalTotalRes),
      sinLlamar: cuenta(senalSinLlamarRes),
      // Nombre y color salen del catálogo aquí, en el servidor: así el
      // componente no necesita el catálogo entero para pintar dos pastillas, y
      // una señal nueva creada desde /configuracion/catalogos aparece sola.
      porValor: senales.map((sn, i) => ({
        valor: sn.valor,
        nombre: sn.nombre,
        color: sn.color,
        count: cuenta(senalPorValorRes[i]),
      })),
    },
    // Las columnas del pipeline son las del catálogo, en su orden, y viajan con
    // su nombre y su color. Escritas a mano en el componente, un estado nuevo
    // creado en /configuracion/catalogos se pintaba sin nombre y con el punto
    // transparente —le pasa hoy mismo al estado `test`—.
    pipeline: opcionesLead.map((c) => ({
      estado: c.valor,
      nombre: c.nombre,
      color: c.color,
      count: allLeads.filter((l) => l.estado === c.valor).length,
    })),
    porAgente: agentes.map((a) => {
      // Las activas, igual que la columna "Interesados" de al lado y que la
      // portada del propio agente. Contando también las dadas de baja, la misma
      // persona veía un número aquí y otro en su pantalla.
      const misCaps = capsActivas.filter((c) => c.agente_id === a.id)
      // Misma pregunta que arriba y misma columna: quién tiene señal.
      const interesados = misCaps.filter((c) => c.senal != null).length
      return {
        id: a.id,
        nombre: `${a.nombre} ${a.apellidos ?? ""}`.trim(),
        initials: a.nombre.charAt(0).toUpperCase() + (a.apellidos?.charAt(0).toUpperCase() ?? ""),
        captaciones: misCaps.length,
        // Por `agente_id`: es quién lo trabaja. Con `captado_por` los leads de
        // Instagram repartidos por la 024 no contaban para nadie, porque nadie
        // los "captó" —entraron solos por un formulario—.
        leads: allLeads.filter((l) => l.agente_id === a.id).length,
        interesados,
        tasa: misCaps.length > 0 ? Math.round((interesados / misCaps.length) * 100) : 0,
      }
    }).sort((a, b) => b.leads - a.leads),
    // El nombre y el color del estado se resuelven aquí, contra el catálogo, y
    // no con un mapa escrito en el componente: `nombreDe` cae al propio valor y
    // `colorDe` a gris, así que un estado retirado se sigue leyendo.
    leadsRecientes: (recientesRes.data ?? []).map((l) => ({
      id: l.id as string,
      nombre: l.nombre as string,
      apellidos: (l.apellidos ?? null) as string | null,
      fuente: (l.fuente ?? null) as string | null,
      estado: l.estado as string,
      estadoNombre: nombreDe(catalogos, "estado_lead", l.estado as string),
      estadoColor: colorDe(catalogos, "estado_lead", l.estado as string),
      fecha_creacion: (l.fecha_creacion ?? null) as string | null,
    })),
    historialCaptaciones: buildHistorial(capsHist, "created_at"),
    historialLeads: buildHistorial(leadsHist, "fecha_creacion"),
  }
}

/**
 * La portada del agente: SU día.
 *
 * Todo lo que es un número se cuenta en la base con `head: true`. Lo que había
 * antes se traía las filas y las sumaba en JavaScript, y eso tenía un fallo que
 * no se veía: PostgREST corta en 1.000 filas devolviendo 200 OK, sin aviso. Con
 * 1.008 leads vivos ya estábamos en el borde; el día que un agente pase de mil,
 * sus tarjetas se habrían quedado congeladas sin que nadie se entere.
 */
async function getAgentData(userId: string): Promise<AgentData> {
  const supabase = await createAdminClient()
  const ahora = new Date()
  const ahoraISO = ahora.toISOString()

  // YA NO ENTRA EL CATÁLOGO: lo leían el pipeline de leads (un contador por
  // estado) y el desglose de WhatsApp, y el dueño ha quitado los dos bloques de
  // la portada. Lo que queda no nombra ni un solo valor de catálogo, así que
  // pedirlo aquí era cargar una lista para no mirarla. El componente lo sigue
  // recibiendo por su lado: lo necesita para las pastillas de cada fila.

  /**
   * La fuente del lead ESPEJO de una captación.
   *
   * Lo usa el filtro de `misRepartidos()`. No sale del catálogo a propósito —es
   * un valor de sistema que nombran el trigger de reparto (024:178) y la vista
   * `v_mi_dia` (024:317)—.
   *
   * ARREGLADO EN REVISIÓN: aquí ponía "igual que `getAgentData` ya nombra
   * 'Pendiente' y 'Enviado' más abajo", y esos dos literales se han ido en este
   * mismo cambio con la resta de la tasa de respuesta. Un ejemplo que manda a
   * buscar algo que ya no está hace dudar del resto del comentario.
   */
  const FUENTE_ESPEJO = "Captaciones"

  /**
   * LA VENTANA DE FILAS DE LAS TARJETAS CON PERIODO.
   *
   * Treinta días es TODO lo que miran los tres periodos cortos (hoy, 7 días, 30
   * días) y las catorce barras. El cuarto, "Todo", no sale de estas filas: sale
   * de un count exacto, que no crece con la tabla. Así la portada del agente
   * nunca se trae el histórico entero de nada —y las demandas son 1.825 filas
   * iguales para los seis agentes—.
   */
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  /**
   * Lo poco que hace falta de un constructor de supabase para ponerle filtros.
   *
   * Existe para escribir los filtros de "sus leads" en UN SOLO SITIO: hacen
   * falta dos veces por tarjeta —el count del total y las filas de la ventana de
   * 30 días— y escritos dos veces se van separando, que es la manera de que un
   * día el número grande y las barras hablen de leads distintos.
   *
   * Por qué las dos conversiones y no un genérico `<T extends ConFiltros<T>>`,
   * que sería lo bonito: los constructores de supabase se tipan a sí mismos de
   * forma recursiva y TypeScript se rinde con "Type instantiation is excessively
   * deep" (TS2589). Devolviendo el tipo de entrada, quien llama conserva su
   * `.in`, su `.gte` y su `.range`. La conversión es cierta: todos estos métodos
   * devuelven el MISMO constructor, no uno nuevo.
   */
  interface Filtrable {
    eq(columna: string, valor: string): Filtrable
    is(columna: string, valor: null): Filtrable
    or(filtro: string): Filtrable
  }

  // Los leads del agente son los que TRABAJA (`agente_id`, migración 024), no
  // los que captó. Es la diferencia que pedía el dueño: un lead de Instagram no
  // lo capta nadie, entra solo por un formulario y se reparte al entrar.
  function soloMios<Q>(q: Q): Q {
    return (q as unknown as Filtrable)
      .eq("agente_id", userId).is("duplicado_de", null) as unknown as Q
  }

  // AQUÍ ESTABA `misLeads()`, el contador suelto de leads del agente. Sólo lo
  // llamaba el pipeline —una consulta por estado del catálogo— y ese bloque se
  // ha ido de la portada, así que se va con él: un contador que no pinta nadie
  // es una consulta por carga de página a cambio de nada. `soloMios` sigue en
  // pie porque de ella cuelga `soloRepartidos`, que es quien alimenta las
  // tarjetas de redes y web.

  // Los leads REPARTIDOS: los que trabaja y que NO son el espejo de una
  // captación suya.
  //
  // El `captacion_id IS NULL` no es cosmético. La migración 026 copia siempre
  // el `agente_id` de una captación a su lead espejo, y el trigger de reparto
  // (024:178) confirma que ese espejo lleva `fuente = 'Captaciones'`. Sin este
  // filtro, la tarjeta 'Captador Idealista' del agente sería el KPI 'Mis
  // captaciones' contado por segunda vez tres centímetros más abajo, y a un
  // agente con 140 captaciones le taparía sus 7 leads de verdad.
  //
  // Es además el mismo criterio que ya usa `v_mi_dia` (024:316) para 'Lo que
  // toca hoy', que está en lo alto de ESTA misma pantalla.
  //
  // Y es el criterio COMPLETO, con sus dos mitades. Un espejo se reconoce por
  // `captacion_id` O por `fuente = 'Captaciones'`, no sólo por la primera: así
  // lo dice la vista (024:316-317), así lo comprueba el trigger de reparto
  // (024:178) y así está escrito el contrato en asignacion.ts:32. Con sólo
  // `captacion_id IS NULL`, un espejo huérfano —los hay: la 003 unificó a mano
  // tres etiquetas viejas del mismo origen, y el workflow 5 de n8n crea el lead
  // por su cuenta cuando el PATCH no encuentra fila— se colaría en la tarjeta
  // 'Captador Idealista' del agente contando por segunda vez una captación que
  // el KPI de arriba ya cuenta, y encima sin salir en 'Lo que toca hoy'.
  //
  // ARREGLADO EN REVISIÓN: la segunda mitad iba como
  // `.not("fuente", "eq", FUENTE_ESPEJO)`, y eso NO es la traducción de
  // `fuente IS DISTINCT FROM 'Captaciones'` (024:317). PostgREST lo manda como
  // `NOT (fuente = 'Captaciones')`, y con `fuente` a NULL esa comparación vale
  // NULL, no cierto: Postgres descarta la fila. O sea que un lead SIN fuente
  // anotada quedaba fuera del bloque entero —ni en el total, ni en ninguna
  // tarjeta— y, peor, el contador [1] (`.is("fuente", null)`) pedía a la vez
  // "fuente nula" y "fuente distinta de Captaciones": imposible, siempre 0. La
  // frase de los restos que promete que la suma cuadra no podía dispararse
  // nunca. Con el `or` los nulos entran, que es lo que hace `IS DISTINCT FROM`.
  function soloRepartidos<Q>(q: Q): Q {
    return (soloMios(q) as unknown as Filtrable)
      .is("captacion_id", null)
      .or(`fuente.is.null,fuente.neq.${FUENTE_ESPEJO}`) as unknown as Q
  }

  /** El contador: cuántos son en total. */
  const misRepartidos = () =>
    soloRepartidos(supabase.from("leads").select("id", { count: "exact", head: true }))

  /** Y las MISMAS filas, con su fecha, para trocearlas por periodo. */
  const misRepartidosFilas = () =>
    soloRepartidos(supabase.from("leads").select("fecha_creacion"))

  const miDia = () =>
    supabase.from("v_mi_dia").select("id", { count: "exact", head: true }).eq("agente_id", userId)

  /**
   * SUS tareas del calendario y sólo las que siguen SIN HACER.
   *
   * Es la misma tabla y el mismo criterio que la agenda de /calendario: suyas
   * por `agente_id` (agenda.ts:46, donde un agente que no es admin sólo ve lo
   * suyo) y `completado = false`, que es lo que la columna "Lo que viene" ya
   * descuenta para no enseñar dos veces lo hecho (proximas-entradas.tsx:27).
   *
   * Se cuenta en la base con `head: true`, no trayendo las filas de
   * `getAgendaMes()` y midiéndolas con `.length`: esa consulta trae SEIS
   * SEMANAS —ni lo vencido de hace dos meses ni lo de dentro de tres— así que
   * contar sobre ella respondería a otra pregunta, y encima con el corte mudo
   * de PostgREST a 1.000 filas esperando.
   */
  const misTareas = () =>
    supabase.from("agenda").select("id", { count: "exact", head: true })
      .eq("agente_id", userId).eq("completado", false)

  // Los tres cortes del día, en hora de Madrid (ver `inicioDiaMadrid`).
  const inicioHoy = inicioDiaMadrid(ahora).toISOString()
  const inicioManana = inicioDiaMadrid(ahora, 1).toISOString()
  const finSemana = inicioDiaMadrid(ahora, 8).toISOString()

  /**
   * LAS DEMANDAS, QUE NO SON DE NADIE EN PARTICULAR.
   *
   * La tabla `demandas` NO TIENE COLUMNA DE AGENTE (id, propiedad_id, nombre,
   * telefono, email, fuente, mensaje, estado, notas, wa_jid, datos_
   * cualificacion, visto, fecha_creacion): una demanda es de un PISO, no de una
   * persona. O sea que este contador da lo mismo —hoy 1.825— para los seis
   * agentes y para el administrador, y por eso la tarjeta que lo pinta dice "de
   * toda la empresa" en la línea de debajo del número. Filtrarlo por agente no
   * es que dé cero: es que no hay por dónde.
   *
   * Sin filtro por agente, son los mismos dos números que ya cuenta el
   * administrador, contados aquí en la base en vez de trayéndose las 1.825
   * filas como hace él.
   */
  const demandas = () =>
    supabase.from("demandas").select("id", { count: "exact", head: true })

  // TRES huecos, contados uno a uno: base · totalesRes · ventanasRes. Este
  // reparto es POR POSICIÓN: si se añade una consulta hay que añadir también su
  // nombre aquí, o cada contador empieza a leer el valor del de al lado y
  // TypeScript no dice nada.
  //
  // Eran CINCO. Se han ido `totalesCaps` —`getTotalesCaptaciones()`, que sólo
  // servía para el desglose por estado de WhatsApp— y `pipelineRes` —una
  // consulta por estado del catálogo—, porque el dueño ha quitado de la portada
  // los dos bloques que los pintaban.
  const [base, totalesRes, ventanasRes] = await Promise.all([
    Promise.all([
      // El total de captaciones activas se cuenta AQUÍ y no se coge de
      // `getTotalesCaptaciones().total`: esa función devuelve `n(todas) ?? 0`, o
      // sea que si ESE contador falla el agente lee un 0 redondo donde tiene 140
      // captaciones. Es el número de la tarjeta 'Scraper · mis captaciones', y
      // por eso sigue en pie aunque el desglose por estado se haya ido: lo pide
      // `origenes.scraper`, que es quien lo enseña.
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("agente_id", userId).eq("activo", true),
      // AQUÍ ESTABAN OTROS DOS CONTADORES DE CAPTACIONES y los dos se han ido
      // por el mismo motivo, que es que ya no los lee nadie:
      //
      //   · el de "este mes", que contestaba a lo que hoy contesta el botón
      //     "30 días" del selector de periodo —y encima sin la ambigüedad de
      //     "este mes", que el día 1 son unas horas y el 30 son treinta días—.
      //   · el de las captaciones SIN estado de WhatsApp, que era el hueco
      //     "Sin escribir" del bloque "Estado WhatsApp · mis captaciones". El
      //     dueño ha quitado ese bloque: con una sola captación pintaba una
      //     barra entera de un solo tramo.
      supabase.from("captaciones")
        .select("id, nombre, telefono, direccion, estado_whatsapp, fecha_agenda, notas_agenda")
        .eq("agente_id", userId)
        .eq("estado_agenda", "pendiente")
        .gte("fecha_agenda", ahoraISO)
        .order("fecha_agenda", { ascending: true })
        .limit(5),
      // LO QUE TOCA HOY. Captaciones, prospectos y leads en una sola consulta:
      // la vista `v_mi_dia` (024) ya los trae unificados.
      //
      // El orden lo decide Postgres, no el navegador, porque sólo se traen 40
      // filas: ordenar en JavaScript ordenaría las 40 que hubieran caído, que no
      // son necesariamente las 40 que tocan.
      //   1. Lo que tiene próximo toque, de más vencido a menos.
      //   2. Lo que nunca se ha atendido, lo más antiguo primero.
      //   3. El resto, por orden de última atención.
      // `prioridad` la calcula la propia vista (migración 024). Tiene que ser
      // así: PostgREST no sabe ordenar por una expresión, y ordenar sólo por
      // `proximo_toque` pondría lo agendado para la semana que viene por encima
      // de lo que no ha tocado nadie nunca. Con 136 leads sin estrenar, eso los
      // manda al fondo el mismo día que empiezan a repartirse.
      //
      // `fuente` llega con la 033 y es la columna que mata la lista de abajo:
      // "Mis últimos leads" enseñaba las mismas personas que ésta y lo ÚNICO
      // que aportaba era de dónde venía cada una. Trayéndola aquí, esa segunda
      // lista deja de tener motivo para existir. Si el dueño todavía no ha
      // ejecutado la 033, PostgREST contesta 400 y la rama `dia.error` de más
      // abajo lo dice con palabras: un fallo visible, no una lista en blanco.
      supabase.from("v_mi_dia")
        .select("ambito, id, titulo, barrio, telefono, proximo_toque, proximo_motivo, atendido_en, senal, entro_en, fuente, prioridad")
        .eq("agente_id", userId)
        .order("prioridad", { ascending: true })
        .order("proximo_toque", { ascending: true, nullsFirst: false })
        .order("entro_en", { ascending: true })
        .limit(TOPE_DIA),
      miDia(),
      miDia().lte("proximo_toque", ahoraISO),
      miDia().is("atendido_en", null),
      // SUS TAREAS DEL CALENDARIO, en tres contadores y no en uno.
      //
      // El total histórico no le dice nada a nadie: una agenda de un año son
      // cientos de tareas hechas y unas pocas que importan. Lo que se cuenta es
      // lo que puede hacer HOY —lo vencido y lo de hoy— y, aparte, lo que viene
      // en la semana, que es lo que salva la tarjeta de quedarse en un cero
      // mudo el día que no toca nada.
      misTareas().lt("fecha", inicioHoy),                                    // vencidas
      misTareas().gte("fecha", inicioHoy).lt("fecha", inicioManana),         // hoy
      misTareas().gte("fecha", inicioManana).lt("fecha", finSemana),         // los 7 días siguientes
    ]),
    // AQUÍ ESTABA EL PIPELINE DE LEADS: una consulta por cada estado del
    // catálogo, una decena de contadores diminutos por carga de página. Se va
    // con su bloque, que ha quitado el dueño —con cuatro leads enseñaba "Nuevo
    // 1 · Contactado 3" y cinco ceros—.

    // LOS TOTALES DE LAS TARJETAS: el número de "Todo" y las demandas sin ver.
    //
    // AQUÍ HABÍA DIECISIETE contadores, dos por cada valor del catálogo
    // `fuente`, que alimentaban una rejilla de siete tarjetas —cinco a cero— que
    // el dueño mandó quitar. Los que quedan no preguntan por un valor sino por
    // una FAMILIA (`FAMILIAS_FUENTE`, arriba): Instagram y Facebook son la misma
    // tarjeta, y el nombre de la fuente lo escriben workflows distintos sin nada
    // que los sujete.
    //
    // Nada de `.length` sobre filas traídas: son todos { count:'exact',
    // head:true }, así que el corte silencioso de PostgREST a 1.000 filas con
    // 200 OK no puede tocarlos. Y cada uno falla por su cuenta: un null es una
    // tarjeta en ámbar, nunca un cero.
    //
    // Los DOS contadores por semana que había aquí ([1] y [3], medidos con
    // `asignado_en`) se van con el selector: lo de los últimos siete días es
    // ahora un botón, y lo cuentan las filas de la ventana de abajo. Se pierde
    // ese matiz —`asignado_en` decía "te lo repartieron esta semana" y
    // `fecha_creacion` dice "entró esta semana"— y es a propósito: el selector
    // es el MISMO que el del administrador y su frase dice "Entrados hoy", así
    // que las dos pantallas tienen que estar contando lo mismo. En el camino
    // normal las dos fechas son la misma —el trigger de reparto (024:178)
    // asigna el lead al crearlo— y sólo se separan al reasignar a mano.
    Promise.all([
      // [0] REDES SOCIALES y [1] WEB: cuántos tiene en total.
      misRepartidos().in("fuente", FAMILIAS_FUENTE.rrss),
      misRepartidos().in("fuente", FAMILIAS_FUENTE.web),
      // [2][3] LAS DEMANDAS DE LA EMPRESA. Sin filtro de agente porque la tabla
      // no tiene esa columna (ver `demandas`). `visto` a false y no "distinto de
      // true": un `visto` nulo no es una demanda sin ver, y así cuenta lo mismo
      // que la portada del administrador.
      demandas(),
      demandas().eq("visto", false),
    ]),
    // LA VENTANA DE 30 DÍAS de las cuatro tarjetas que responden al periodo.
    //
    // Sólo la fecha de cada fila: es lo único que hace falta para trocearlas en
    // hoy / 7 días / 30 días y para las catorce barras. El total NO sale de
    // aquí, sale de los count exactos de arriba, así que estas consultas no
    // crecen con la tabla por mucho que el CRM lleve años funcionando.
    //
    // Paginadas con `traerTodo`: un `select` suelto lo corta PostgREST a 1.000
    // filas con 200 OK y sin avisar, y las que se pierden son justo las más
    // recientes —las de las barras—. Las demandas de la empresa son las únicas
    // que se acercan a ese tope, y por eso son también las únicas que valía la
    // pena medir: 1.825 filas de histórico para CADA agente en CADA carga era
    // demasiado, 30 días de una sola columna no lo es.
    Promise.all([
      traerTodo<{ fecha_creacion: string | null }>(() =>
        misRepartidosFilas().in("fuente", FAMILIAS_FUENTE.rrss)
          .gte("fecha_creacion", hace30).order("fecha_creacion", { ascending: true })),
      traerTodo<{ fecha_creacion: string | null }>(() =>
        misRepartidosFilas().in("fuente", FAMILIAS_FUENTE.web)
          .gte("fecha_creacion", hace30).order("fecha_creacion", { ascending: true })),
      // Las captaciones se fechan con `created_at`, no con `fecha_creacion`.
      // Mismos filtros que su contador (suyas y activas) para que el número
      // grande y las barras hablen de las mismas fichas.
      traerTodo<{ created_at: string | null }>(() =>
        supabase.from("captaciones").select("created_at")
          .eq("agente_id", userId).eq("activo", true)
          .gte("created_at", hace30).order("created_at", { ascending: true })),
      traerTodo<{ fecha_creacion: string | null }>(() =>
        supabase.from("demandas").select("fecha_creacion")
          .gte("fecha_creacion", hace30).order("fecha_creacion", { ascending: true })),
    ]),
  ])

  // OJO: el `recientesRes` que sigue existiendo en este fichero (el del
  // ADMINISTRADOR) conserva su lista de últimos leads de TODO el equipo y
  // AdminDashboard la sigue pintando. Son dos consultas distintas con el mismo
  // nombre en dos funciones distintas; aquí sólo se quitó la del agente. Se
  // nombra la función y no el número de línea a propósito: este fichero se
  // mueve entero a cada cambio y un número caduca al día siguiente.
  // NUEVE huecos, contados uno a uno. Eran diez: el de las captaciones sin
  // estado de WhatsApp se ha ido con el bloque que lo pintaba, y por eso
  // `agendaRes` ha subido un puesto.
  const [capsActivasRes, agendaRes,
    diaRes, diaTotalRes, diaVencidosRes, diaSinAtenderRes,
    tareasVencidasRes, tareasHoyRes, tareasSemanaRes] = base
  // CUATRO contadores y CUATRO ventanas, contados uno a uno. El reparto es POR
  // POSICIÓN: si se añade o se quita una consulta hay que mover también su hueco
  // aquí, o cada uno empieza a leer el del al lado y TypeScript no lo canta.
  const [rrssTotalRes, webTotalRes, demandasTotalRes, demandasSinVerRes] = totalesRes
  const [rrssFilas, webFilas, capsFilas, demandasFilas] = ventanasRes

  type FilaVista = {
    ambito: string
    id: string
    titulo: string | null
    barrio: string | null
    telefono: string | null
    proximo_toque: string | null
    proximo_motivo: string | null
    atendido_en: string | null
    senal: string | null
    entro_en: string | null
    /** Valor del catálogo `fuente`, no un texto bonito: lo traduce la pantalla. */
    fuente: string | null
  }

  // "Vencido" se decide comparando MILISEGUNDOS, no cadenas.
  //
  // El contador de vencidos lo calcula Postgres (`.lte(proximo_toque, ahora)`) y
  // el filo rojo de la fila lo calculaba JavaScript comparando dos textos: el que
  // devuelve PostgREST ("2026-09-15T08:30:00+00:00") contra el de
  // `toISOString()` ("2026-09-15T08:30:00.000Z"). Son dos formatos distintos para
  // la misma hora, así que el orden alfabético no tiene por qué coincidir con el
  // orden del tiempo —y basta con que el servidor de base de datos no esté en UTC
  // para que deje de coincidir del todo—. La cabecera diría "3 vencidos" y abajo
  // saldrían cuatro filos rojos. Con getTime() los dos lados miden lo mismo.
  const ahoraMs = ahora.getTime()
  const vencidoSegun = (iso: string | null) => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return !Number.isNaN(ms) && ms <= ahoraMs
  }

  const filasDia: FilaDia[] = ((diaRes.data ?? []) as FilaVista[]).map((f) => {
    const vencido = vencidoSegun(f.proximo_toque)
    const nuncaAtendido = !f.atendido_en
    return {
      clave: `${f.ambito}-${f.id}`,
      // EL ID SUELTO, además de la clave. Es lo que le falta a cada fila para
      // poder llevar a SU ficha (`/captaciones?id=…`, `/leads?lead=…`) en vez
      // de a la lista entera, que es donde llevaba hasta hoy: con 759
      // captaciones, buscar a mano el nombre que acabas de leer.
      //
      // La vista lo devuelve como TEXTO para las tres tablas a la vez —el de
      // una captación es un número y el de un lead una uuid—, así que viaja
      // como texto y cada pantalla de destino lo valida a su manera.
      id: f.id,
      ambito: f.ambito,
      titulo: f.titulo?.trim() || "Sin nombre",
      barrio: f.barrio,
      telefono: f.telefono,
      senal: f.senal,
      // Viaja el VALOR, no el nombre. El nombre y el color los resuelve el
      // componente con `nombreDe`/`colorDe`, igual que hace ya con la señal:
      // así una fuente renombrada en /configuracion/catalogos cambia sola y una
      // que no esté catalogada se sigue leyendo por su propio valor.
      fuente: f.fuente,
      motivo: f.proximo_motivo,
      vencido,
      // El `?? "sin fecha"` no es paranoia de más: las dos ayudantes devuelven
      // null ante una fecha que no se puede leer, y dentro de una plantilla eso
      // se pinta como el texto "null" —"para el null"— en la portada del agente.
      toqueTexto: f.proximo_toque
        ? (vencido
            ? `vencido ${desdeHace(f.proximo_toque) ?? "hace tiempo"}`
            : `para el ${fechaCorta(f.proximo_toque) ?? "sin fecha"}`)
        : null,
      // "Desde cuándo espera": si nunca se le ha llamado, desde que entró; si ya
      // se le llamó, desde la última vez. Las dos respuestas a la misma
      // pregunta, que es cuánto lleva este teléfono sin sonar.
      esperaTexto: nuncaAtendido
        ? `sin atender, entró ${desdeHace(f.entro_en) ?? "sin fecha"}`
        : `última llamada ${desdeHace(f.atendido_en) ?? "sin fecha"}`,
      nuncaAtendido,
    }
  })

  // AQUÍ ESTABAN LA TASA DE RESPUESTA Y LOS INTERESADOS DEL AGENTE, y se han
  // ido con sus dos tarjetas: el dueño quitó "Mis leads", "Interesados" y "Tasa
  // respuesta" de la portada. Con ellas se van también sus consultas —el
  // contador de leads (`misLeads()` suelto), el de captaciones con señal, y los
  // dos valores de `totalesCaps.porEstado` que sólo servían para la resta de la
  // tasa—, porque un contador que no pinta nadie es una consulta por carga de
  // página a cambio de nada.
  //
  // Y EN EL CAMBIO QUE QUITÓ LOS DOS EMBUDOS del final de la portada —"Estado
  // WhatsApp · mis captaciones" y "Mi pipeline de leads"— se han ido con ellos
  // `misLeads()` y su decena de contadores por estado, `getTotalesCaptaciones()`
  // y el contador de captaciones sin estado. El `interesadosTotal` del
  // ADMINISTRADOR es otra variable en otra función y sigue en pie.
  //
  // Lo que NO se ha tocado: el count de captaciones activas (`capsActivas`), que
  // es el total de la tarjeta 'Scraper · mis captaciones'.
  //
  // Y EN EL CAMBIO A SEIS TARJETAS se han ido también: los diecisiete
  // contadores por fuente del catálogo, la consulta `conDia()` con sus dos
  // restas —`visitas`, que alimentaba la tarjeta "Visita por programar"— y las
  // constantes que sólo usaban ellas (`TIPOS_CON_DIA`, `TOPE_CON_DIA`,
  // `ESTADO_INTERESADO`) y la lista `fuentesVisibles`.
  //
  // ARREGLADO EN REVISIÓN: este párrafo terminaba diciendo que quedaban seis
  // contadores y que `capsMesRes` seguía vivo como el "N este mes" del
  // scraper. Las dos cosas dejaron de ser ciertas con el selector de periodo:
  // hoy son CUATRO count exactos (`totalesRes`) más CUATRO ventanas de 30 días
  // (`ventanasRes`), y el contador del mes se borró porque ese número lo
  // contesta ya el botón "30 días". Quien viniera a limpiar restos buscaría un
  // `capsMesRes` que no existe y dudaría del resto del párrafo, que sí vale;
  // se nombran las dos variables y no sus líneas porque esta función se mueve
  // entera a cada cambio.
  const capsActivas = cuenta(capsActivasRes)

  /**
   * UNA TARJETA CON PERIODO: la ventana de 30 días da hoy / 7 días / 30 días y
   * las catorce barras, y el count exacto pisa el total, que es el único de los
   * cuatro números que mira más atrás de la ventana.
   *
   * Si el count falló, la tarjeta ENTERA vale null y el componente la pinta en
   * ámbar: sin el total no se puede afirmar nada, ni siquiera que hoy no haya
   * entrado nada. Si lo que falla es la ventana, `traerTodo` devuelve lo que
   * llevara traído —media portada es mejor que una pantalla de error—, así que
   * el total sigue siendo bueno y son los tres periodos cortos los que se
   * quedan flojos. Es el mismo trato que tienen hoy las barras del
   * administrador.
   *
   * Se trocea con `ahora`, el MISMO instante con el que se escribe `cortes` un
   * poco más abajo — que es el que viaja en el enlace de la tarjeta. Dejando
   * que `porPeriodo` se leyera su propio reloj, el número y la lista de destino
   * se contaban con dos cortes separados por lo que tardaran las consultas.
   */
  const conTotal = (
    filas: Array<{ fecha_creacion?: string | null }>,
    total: number | null,
  ): Periodos | null => (total == null ? null : { ...porPeriodo(filas, ahora), total })

  const demandasPeriodos = conTotal(demandasFilas, cuenta(demandasTotalRes))

  return {
    captaciones: capsActivas,
    // LOS VALORES DE `fuente` QUE CUENTA CADA TARJETA DE LEADS, para que su
    // enlace pueda pedirle a /leads exactamente esas filas. Son las MISMAS
    // listas con las que se han contado los dos números de arriba
    // (`totalesRes`), no una copia escrita en el componente: si mañana entra
    // 'TikTok' en la familia, el número y la lista de destino se mueven juntos.
    fuentes: { rrss: FAMILIAS_FUENTE.rrss, web: FAMILIAS_FUENTE.web },
    // Y DÓNDE EMPIEZA CADA PERIODO CORTO, ya calculado aquí.
    //
    // Viaja el instante exacto con el que se han troceado las filas
    // (`cortesPeriodo`), no la palabra "semana", porque es lo que hace que la
    // lista de /leads enseñe LOS MISMOS que promete la tarjeta. Calcularlo en el
    // componente sería calcularlo con Date.now() durante el render: el servidor
    // y el navegador escribirían dos enlaces distintos y React lo cantaría como
    // desajuste de hidratación.
    cortes: (() => {
      const c = cortesPeriodo(ahora)
      return {
        hoy: new Date(c.hoy).toISOString(),
        semana: new Date(c.semana).toISOString(),
        mes: new Date(c.mes).toISOString(),
      }
    })(),
    // Las tareas del calendario, cada contador por su cuenta: si falla el de
    // vencidas, el de hoy no tiene por qué callarse también.
    tareas: {
      vencidas: cuenta(tareasVencidasRes),
      hoy: cuenta(tareasHoyRes),
      semana: cuenta(tareasSemanaRes),
    },
    // LAS CUATRO TARJETAS QUE RESPONDEN AL SELECTOR, cada una con sus cuatro
    // periodos y sus catorce barras, y cada una fallando por su cuenta: que no
    // se puedan contar las demandas de la empresa no tiene por qué dejar sin
    // número los leads del agente.
    origenes: {
      rrss: conTotal(rrssFilas, cuenta(rrssTotalRes)),
      web: conTotal(webFilas, cuenta(webTotalRes)),
      // Las captaciones se fechan con `created_at`; `porPeriodo` habla en
      // `fecha_creacion`, así que se le traduce el nombre de la columna aquí,
      // igual que hace la portada del administrador con la fecha del historial.
      scraper: conTotal(capsFilas.map((c) => ({ fecha_creacion: c.created_at })), capsActivas),
      // De TODA la empresa: la tabla no tiene agente (ver `demandas`, arriba).
      // `sinVer` va pegado a los periodos porque lo pinta la misma tarjeta, y
      // puede valer null por su cuenta sin tumbarla: "no sé cuántas faltan por
      // ver" no es "no sé cuántas hay".
      demandas: demandasPeriodos && { ...demandasPeriodos, sinVer: cuenta(demandasSinVerRes) },
    },
    agenda: (agendaRes.data ?? []).map((a) => ({
      id: a.id as number,
      nombre: (a.nombre ?? null) as string | null,
      telefono: (a.telefono ?? null) as string | null,
      direccion: (a.direccion ?? null) as string | null,
      estado_whatsapp: (a.estado_whatsapp ?? null) as string | null,
      cuando: fechaCorta(a.fecha_agenda as string | null),
      notas: (a.notas_agenda ?? null) as string | null,
    })),
    dia: {
      filas: filasDia,
      total: cuenta(diaTotalRes),
      vencidos: cuenta(diaVencidosRes),
      sinAtender: cuenta(diaSinAtenderRes),
      // La vista llega con la migración 024. Si el dueño todavía no la ha
      // ejecutado esto falla, y hay que DECIRLO: una sección vacía sin más se
      // lee como "no tienes nada que hacer hoy".
      error: Boolean(diaRes.error),
    },
  }
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // `permisos` entra en el mismo `select` que ya se hacía, sin consulta de más:
  // lo lee la portada del agente para saber si la fila de un prospecto puede
  // enlazar a /prospectos. El módulo va cerrado por defecto (PERMISOS_DEFAULT),
  // así que para casi todos ese enlace sólo llevaba a /sin-acceso.
  const { data: perfil } = await supabase
    .from("perfiles").select("nombre, rol, permisos").eq("id", user.id).single()

  const hora = new Date().getHours()
  const saludo = hora < 13 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches"
  const isAdmin = perfil?.rol === "Admin"

  // Estados, fuentes y colores salen del catálogo editable. Antes había una
  // lista `ESTADOS_LEAD` escrita aquí: un estado creado desde
  // /configuracion/catalogos no aparecía en el pipeline y sus leads no los
  // contaba nadie.
  const [agenda, catalogos] = await Promise.all([getAgendaMes(), getCatalogosActivos()])

  if (isAdmin) {
    const data = await getAdminData(catalogos)
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
      saludo={saludo}
      data={data}
      catalogos={catalogos}
      agendaEquipo={agenda}
      yoId={user.id}
      // `resolverPermisos` completa las claves que falten en vez de darlas por
      // denegadas: los perfiles viejos sólo llevan tres.
      puedeProspectos={resolverPermisos(perfil?.permisos).prospectos}
    />
  )
}
