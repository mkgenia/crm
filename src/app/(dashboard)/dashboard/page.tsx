import { createClient, createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import AdminDashboard, { type AdminData } from "./AdminDashboard"
import AgentDashboard, { type AgentData, type FilaDia } from "./AgentDashboard"
import { getAgendaMes } from "@/lib/actions/agenda"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { getTotalesCaptaciones } from "@/lib/actions/captaciones"
import { opcionesDe, nombreDe, colorDe, type Catalogo } from "@/lib/catalogos"
import { traerTodo } from "@/lib/supabase/paginar"

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
 * Un contador que falla vale `null`, nunca 0.
 *
 * Un 0 se lee como "no tienes nada pendiente" y es justo la mentira que no nos
 * podemos permitir en la pantalla que el agente abre por la mañana.
 */
const cuenta = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0)

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
async function getAgentData(userId: string, catalogos: Catalogo[]): Promise<AgentData> {
  const supabase = await createAdminClient()
  const ahora = new Date()
  const ahoraISO = ahora.toISOString()
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()

  const estadosLead = opcionesDe(catalogos, "estado_lead").map((c) => c.valor)

  // Las fuentes salen del catálogo, una por una y con su nombre y su color.
  //
  // NO se copian aquí las FAMILIAS que usa el administrador (205-210): son una
  // lista escrita a mano, dejan fuera dos de las ocho fuentes —'WhatsApp' y
  // 'Solicitud valoración' caen en "otros" y pierden hasta el nombre— y meten
  // 'Trasteros WhatsApp' dentro de 'qr'. El dueño pidió ver de dónde vienen sus
  // leads nombrándolos uno a uno, que es exactamente lo que ya hay en la 012.
  const fuentes = opcionesDe(catalogos, "fuente")

  /**
   * La fuente del lead ESPEJO de una captación.
   *
   * Se escribe aquí una sola vez porque la usan dos cosas que tienen que decir
   * lo mismo: el filtro de `misRepartidos()` y la lista de tarjetas. No sale del
   * catálogo a propósito —es un valor de sistema que nombran el trigger de
   * reparto (024:178) y la vista `v_mi_dia` (024:317)—, igual que
   * `getAgentData` ya nombra "Pendiente" y "Enviado" más abajo.
   */
  const FUENTE_ESPEJO = "Captaciones"

  /**
   * Las fuentes que SÍ pueden tener tarjeta.
   *
   * ARREGLADO EN REVISIÓN: antes se pintaba una tarjeta por cada fuente del
   * catálogo, `Captaciones` incluida. Pero `misRepartidos()` excluye justo esa
   * fuente, así que su contador vale 0 pase lo que pase, y un 0 acaba en la
   * frase del pie: a un agente con 140 captaciones se le leía "Todavía no te ha
   * llegado nada por Captador Idealista", que es exactamente lo contrario de la
   * verdad. Aquí no sale porque va aparte —lo dice el subtítulo del bloque, con
   * su enlace a /captaciones—, no porque esté vacía. Dos consultas menos.
   */
  const fuentesVisibles = fuentes.filter((f) => f.valor !== FUENTE_ESPEJO)

  const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Los leads del agente son los que TRABAJA (`agente_id`, migración 024), no
  // los que captó. Es la diferencia que pedía el dueño: un lead de Instagram no
  // lo capta nadie, entra solo por un formulario y se reparte al entrar.
  const misLeads = () =>
    supabase.from("leads").select("id", { count: "exact", head: true })
      .eq("agente_id", userId)
      .is("duplicado_de", null)

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
  const misRepartidos = () =>
    misLeads().is("captacion_id", null)
      .or(`fuente.is.null,fuente.neq.${FUENTE_ESPEJO}`)

  const miDia = () =>
    supabase.from("v_mi_dia").select("id", { count: "exact", head: true }).eq("agente_id", userId)

  const [totalesCaps, base, pipelineRes, origenesRes] = await Promise.all([
    // Las captaciones activas y su desglose por estado de WhatsApp ya se cuentan
    // en la base aquí dentro, con la lista de estados salida del catálogo. Para
    // un agente filtra por `agente_id` solo.
    getTotalesCaptaciones(),
    Promise.all([
      // El total de captaciones activas se cuenta AQUÍ y no se coge de
      // `getTotalesCaptaciones().total`: esa función devuelve `n(todas) ?? 0`, o
      // sea que si ESE contador falla el agente lee un 0 redondo donde tiene 140
      // captaciones. El desglose por estado sí devuelve null como toca, así que
      // ése se sigue usando tal cual. Mismos filtros que allí (activo = true y
      // suyas) para que el titular y el desglose hablen de las mismas filas.
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("agente_id", userId).eq("activo", true),
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("agente_id", userId).eq("activo", true).gte("created_at", inicioMes),
      // Las que todavía no tienen estado de WhatsApp. No son de ningún valor del
      // catálogo, así que sin contarlas aparte la tasa de respuesta saldría
      // inflada: irían al saco de "ha contestado" sin haberlo hecho.
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("agente_id", userId).eq("activo", true).is("estado_whatsapp", null),
      misLeads(),
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
      // Las suyas con SEÑAL. Se cuenta aquí y no se saca de
      // `getTotalesCaptaciones`, que sólo desglosa `estado_whatsapp`: la señal
      // es otra columna y otra pregunta.
      supabase.from("captaciones").select("id", { count: "exact", head: true })
        .eq("agente_id", userId).eq("activo", true).not("senal", "is", null),
    ]),
    // Una consulta por estado del catálogo. Son una decena de contadores
    // diminutos en paralelo, no una fila por lead.
    Promise.all(estadosLead.map((e) => misLeads().eq("estado", e))),
    // DE DÓNDE VIENEN SUS LEADS. Dos contadores por cada fuente con tarjeta
    // (hoy siete: las ocho activas del catálogo menos la del espejo), más el
    // total del bloque y los dos huecos.
    //
    // Nada de `.length` sobre filas traídas: son todos { count:'exact',
    // head:true }, así que el corte silencioso de PostgREST a 1.000 filas con
    // 200 OK no puede tocarlos. Son 17 contadores diminutos en paralelo. Si
    // algún día pesan, la salida es una RPC `mis_leads_por_fuente(uuid)` con
    // GROUP BY: el contrato de `AgentData.origenes` no cambiaría.
    Promise.all([
      misRepartidos(),                                  // [0] total del bloque
      misRepartidos().is("fuente", null),               // [1] sin fuente anotada
      // [2] los que llevan una fuente que no está ACTIVA en el catálogo.
      // Cada valor va entrecomillado: 'Solicitud valoración' y 'Trasteros
      // WhatsApp' llevan espacio y 'Captación' lleva tilde; sin comillas el
      // filtro se rompe o cuenta otra cosa. Y si el catálogo llegara vacío,
      // `in ()` es sintaxis inválida: se devuelve null, no 0.
      fuentes.length
        ? misRepartidos().not("fuente", "is", null)
            .not("fuente", "in", `(${fuentes.map((f) => `"${f.valor}"`).join(",")})`)
        : Promise.resolve({ count: null, error: true }),
      // [3+] pares (total, semana) en el orden de `fuentesVisibles`.
      // La semana se mide con `asignado_en`, no con `fecha_creacion`: un lead
      // de marzo que te reparten hoy es nuevo PARA TI. Los repartidos antes de
      // la 013 tienen `asignado_en` a null y no cuentan como recientes, que es
      // lo correcto. El espejo de captación también recibe `asignado_en` (026),
      // pero aquí ya está excluido.
      //
      // OJO: `fuentesVisibles`, no `fuentes`. La lista de arriba (el `in` de
      // [2]) sí lleva el catálogo ENTERO: ahí se pregunta qué valores están
      // catalogados, y `Captaciones` lo está.
      ...fuentesVisibles.flatMap((f) => [
        misRepartidos().eq("fuente", f.valor),
        misRepartidos().eq("fuente", f.valor).gte("asignado_en", hace7),
      ]),
    ]),
  ])

  // OJO: el `recientesRes` que sigue existiendo en este fichero (se pide en la
  // línea 94 y se mapea en la 361) es el del ADMINISTRADOR, que sí conserva su
  // lista de últimos leads de TODO el equipo y que AdminDashboard sigue pintando
  // (AdminDashboard.tsx:318). Son dos consultas distintas con el mismo nombre en
  // dos funciones distintas; aquí sólo se ha quitado la del agente. Se nombran
  // las líneas a propósito: "unas líneas más arriba" mandaba a buscar cerca y
  // está a casi quinientas, así que el siguiente que limpie por aquí se lo
  // llevaría por delante creyendo que es un resto del borrado.
  const [capsActivasRes, capsMesRes, capsSinEstadoRes, leadsTotalRes, agendaRes,
    diaRes, diaTotalRes, diaVencidosRes, diaSinAtenderRes, senalRes] = base

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

  // Aquí sí se nombran dos valores sueltos, y no es una lista de estados
  // escondida: la LISTA entera sale del catálogo (es `totalesCaps.porEstado`, y
  // el desglose de la pantalla la recorre completa). Lo que se nombra son los
  // dos valores concretos que dan sentido a un KPI derivado —quién ha
  // contestado—, igual que hace la cabecera de /captaciones. Son de `sistema`,
  // así que no se pueden borrar del catálogo, y si alguno faltara el KPI sale a
  // null en vez de mentir.
  //
  // Eran cuatro. Los otros dos, `Interesado` y `Quiere_Llamada`, dejaron de ser
  // estados con la 027 y se cuentan desde `senal` unas líneas más abajo.
  const capsActivas = cuenta(capsActivasRes)
  const sinEstado = cuenta(capsSinEstadoRes)
  const pendientes = totalesCaps.porEstado["Pendiente"]
  const enviadas = totalesCaps.porEstado["Enviado"]

  // Ha contestado el que no está ni sin escribir, ni recién escrito, ni sin
  // estado. Si falta cualquiera de los tres sumandos la tasa vale null y no se
  // pinta: media resta da un porcentaje falso, no un porcentaje aproximado.
  const sinContestar =
    pendientes == null || enviadas == null || sinEstado == null
      ? null
      : pendientes + enviadas + sinEstado
  const tasaRespuesta =
    sinContestar == null || capsActivas == null || capsActivas === 0
      ? null
      : Math.round(((capsActivas - sinContestar) / capsActivas) * 100)

  // Los suyos con SEÑAL, contados en la base.
  //
  // Esto era `porEstado["Interesado"] + porEstado["Quiere_Llamada"]`.
  // `getTotalesCaptaciones` desglosa por los valores ACTIVOS del catálogo de
  // `estado_whatsapp`, y la 027 archivó esos dos: las dos claves salían
  // `undefined`, `undefined == null` es cierto y el KPI se quedaba en null para
  // siempre. No roto: invisible, que se nota bastante menos.
  const interesadosTotal = cuenta(senalRes)

  return {
    captaciones: capsActivas,
    captacionesEsteMes: cuenta(capsMesRes),
    // El desglose de WhatsApp, con su nombre y su color tal y como estén en
    // /configuracion/catalogos. Un estado nuevo aparece aquí solo.
    wa: opcionesDe(catalogos, "estado_whatsapp").map((c) => ({
      valor: c.valor,
      nombre: c.nombre,
      color: c.color,
      count: totalesCaps.porEstado[c.valor] ?? null,
    })),
    // Las que todavía no tienen estado NO son de ningún valor del catálogo, así
    // que no caen en ninguna pastilla: el desglose sumaba menos que el titular y
    // esas filas desaparecían de la pantalla sin dejar rastro. Antes iban dentro
    // de "Pendiente" a mano, y eso era mentir en la otra dirección —no es lo
    // mismo un WhatsApp por escribir que uno escrito y sin contestar—. Va aparte
    // y sólo si hay alguna. No es un estado escondido: es el hueco de los que no
    // tienen ninguno.
    waSinEstado: sinEstado,
    interesadosTotal,
    tasaRespuesta,
    leadsTotal: cuenta(leadsTotalRes),
    // Nombre y color se resuelven AQUÍ, en el servidor, igual que hace el
    // administrador con `senal.porValor` (page.tsx:321): así el componente no
    // necesita recorrer el catálogo entero para pintar la rejilla.
    origenes: {
      total: cuenta(origenesRes[0]),
      sinFuente: cuenta(origenesRes[1]),
      fueraDeCatalogo: cuenta(origenesRes[2]),
      porFuente: fuentesVisibles.map((f, i) => ({
        valor: f.valor,
        nombre: f.nombre,
        color: f.color,
        total: cuenta(origenesRes[3 + i * 2]),
        semana: cuenta(origenesRes[3 + i * 2 + 1]),
      })),
    },
    pipeline: estadosLead.map((e, i) => ({ estado: e, count: cuenta(pipelineRes[i]) })),
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

  const { data: perfil } = await supabase
    .from("perfiles").select("nombre, rol").eq("id", user.id).single()

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

  const data = await getAgentData(user.id, catalogos)
  return (
    <AgentDashboard
      nombre={perfil?.nombre ?? "—"}
      saludo={saludo}
      data={data}
      catalogos={catalogos}
      agendaEquipo={agenda}
      yoId={user.id}
    />
  )
}
