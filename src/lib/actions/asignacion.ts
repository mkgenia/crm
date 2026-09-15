"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"
import { REGLAS_POR_DEFECTO, type AgenteReparto, type ReglasAsignacion } from "@/lib/asignacion"

/**
 * El reparto entre los agentes: captaciones Y leads.
 *
 * Se reparten las dos cosas, pero NO con la misma regla, y esa diferencia es el
 * quid de todo este fichero:
 *
 *   · Una CAPTACIÓN se reparte cuando hay SEÑAL: la IA ha entendido interés en
 *     lo que contestó el propietario y `captaciones.senal` deja de estar vacía
 *     (migración 027). Contestar no basta —'Respondido' lo es también el que
 *     contesta que no le interesa—, y por eso el reparto ya no mira
 *     `estado_whatsapp`: hasta la 027 sí lo miraba, con los estados
 *     'Interesado' y 'Quiere_Llamada' de la 020, que la 027 fundió en
 *     'Respondido' y archivó del catálogo. Una captación recién scrapeada es un
 *     anuncio al que nadie ha escrito: mientras tanto el que trabaja es el bot.
 *     Repartirla antes le llena la pantalla al agente de propiedades que nunca
 *     contestarán y desordena el turno de los demás por trabajo que no existe.
 *     (En la 017 estaba mal: disparaba al insertar.)
 *
 *   · Un LEAD de demanda se reparte AL ENTRAR (migración 024). Rellenar el
 *     formulario de Instagram o el de la ficha de una propiedad YA es el
 *     interés: no hay nada que esperar, y cada hora sin dueño es una hora que
 *     nadie llama. Hasta la 024 no se repartían: 136 personas habían levantado
 *     la mano y no le tocaban a nadie.
 *
 * Los espejos de captación (leads con `captacion_id`, o con fuente
 * 'Captaciones') no entran por aquí: son la sombra de un anuncio y se reparten
 * por el lado de la captación. Si entraran, el mismo propietario se repartiría
 * dos veces y podría caerle a dos agentes distintos.
 *
 * A quién le toca no se decide aquí, se decide en la base de datos
 * (`siguiente_agente()` y los triggers de las migraciones 027 y 024; los de la
 * 020 los reemplazó la 027 al mover el disparo a `senal`). Tiene que
 * ser así porque ni las captaciones ni los leads pasan por este código: las
 * primeras las escribe el workflow de ingesta contra PostgREST y los segundos
 * los escriben cinco webhooks públicos de n8n. Si la rotación viviera en
 * TypeScript, todo lo que entra por el scraper y por la landing se quedaría sin
 * repartir — que es exactamente lo que pasaba con los leads.
 *
 * Lo que sí vive aquí es lo que la base de datos no puede saber: quién está
 * pidiendo la acción y si tiene permiso.
 */

const CLAVES = ["asignacion_modo", "asignacion_cursor", "asignacion_reglas"] as const

export type ModoAsignacion = "manual" | "automatico"

export interface EstadoAsignacion {
  modo: ModoAsignacion
  cursor: number
  reglas: ReglasAsignacion
  /**
   * Lo que lleva abierto cada agente, de lo uno y de lo otro.
   *
   * `null` es "no se ha podido contar", y entonces no se pinta. Un 0 al lado de
   * un nombre se lee como "éste está libre, cárgale más": es justo la decisión
   * contraria a la que tocaría si el número lo que pasa es que falló.
   */
  agentes: Array<AgenteReparto & { captacionesAbiertas: number | null; leadsAbiertos: number | null }>
  /**
   * Si la plantilla se llegó a leer.
   *
   * Es la misma regla que el `null` de los contadores, aplicada a la lista: si
   * la consulta de `perfiles` falla, `agentes` llega vacía, y una lista vacía se
   * lee como "no hay nadie en el turno" — que además apagaba los dos botones de
   * repartir. O sea: por un fallo de lectura el panel afirmaba algo falso Y
   * dejaba sin repartir lo que la RPC sí habría repartido. Con esto el panel
   * puede decir "no se sabe" en vez de "no hay".
   */
  agentesLeidos: boolean
  /**
   * Las dos colas que esperan agente.
   *
   * `null` significa "no se ha podido contar", y entonces NO se pinta el
   * número. Un 0 en pantalla se lee como "no hay nada esperando" y haría que
   * nadie volviera a pulsar el botón; un hueco se lee como lo que es.
   */
  captacionesPendientes: number | null
  leadsPendientes: number | null
}

async function leerAjustes(supabase: Awaited<ReturnType<typeof createAdminClient>>) {
  const { data } = await supabase.from("app_settings").select("key, value").in("key", CLAVES as unknown as string[])
  const m = new Map((data ?? []).map((r) => [r.key, r.value]))
  return {
    modo: (m.get("asignacion_modo") ?? "manual") as ModoAsignacion,
    cursor: Number(m.get("asignacion_cursor") ?? 0) || 0,
    reglas: { ...REGLAS_POR_DEFECTO, ...((m.get("asignacion_reglas") ?? {}) as Partial<ReglasAsignacion>) },
  }
}

async function guardarAjuste(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  key: string,
  value: unknown
) {
  await supabase.from("app_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  )
}

type Supa = Awaited<ReturnType<typeof createAdminClient>>

/**
 * Refrescar todo lo que se mueve cuando una captación cambia de agente.
 *
 * No basta con /captaciones, y ésa era la asimetría del fichero: el lado de los
 * leads ya refrescaba las dos pantallas y el de las captaciones no. Cambiar el
 * `agente_id` de una captación dispara el trigger de la migración 026, que copia
 * ese agente al lead espejo del mismo propietario; sin revalidar /leads y
 * /contactos, ese contacto sigue apareciendo sin dueño (o con el anterior) hasta
 * que alguien recargue a mano. Y /dashboard porque de ahí sale la carga de cada
 * agente, que acaba de cambiar.
 */
function revalidarCaptaciones() {
  revalidatePath("/captaciones")
  revalidatePath("/leads")
  revalidatePath("/contactos")
  revalidatePath("/dashboard")
}

/**
 * La cola de captaciones que el botón puede repartir ahora mismo.
 *
 * Los filtros son los de `repartir_interesadas_pendientes()` clavados: sin
 * agente, `senal IS NOT NULL`, `activo IS NOT FALSE` —que incluye las que tienen
 * el campo a NULL, cosa que un `activo = true` deja fuera— y teléfono no vacío.
 * Si el contador y la RPC no filtran igual, el panel promete captaciones que el
 * botón no va a repartir y el dueño se queda mirando un número que no baja.
 *
 * El interés se lee de `senal` y no de `estado_whatsapp` desde la 027, y por eso
 * aquí ya no hay ninguna lista de valores escrita a mano: "tiene señal" no es
 * una lista, es que la columna no esté vacía. Da igual qué señales tenga hoy el
 * catálogo `senal_interes` o cuáles añada el administrador mañana —la RPC
 * tampoco las enumera—, así que el contador no se queda viejo cuando crezca.
 *
 * Se cuenta con `count: exact` y `head: true`: el número lo da Postgres, no un
 * `.length` sobre las filas traídas. PostgREST corta en 1.000 filas en silencio
 * y con un 200 OK, así que contar sobre lo cargado miente en cuanto hay trabajo
 * de verdad.
 */
async function contarCaptacionesPendientes(supabase: Supa): Promise<number | null> {
  const { count, error } = await supabase.from("captaciones")
    .select("id", { count: "exact", head: true })
    .is("agente_id", null)
    // El `senal IS NOT NULL` de la RPC. En supabase-js hay que decirlo con
    // `.not(col, "is", null)`: un `.neq("senal", null)` se traduce a una
    // comparación contra NULL, que en SQL nunca es cierta, y el contador saldría
    // siempre a cero mientras el botón sí reparte.
    .not("senal", "is", null)
    .or("activo.is.null,activo.is.true")
    // El `telefono IS NOT NULL AND telefono <> ''` de la RPC, dicho de la única
    // forma en que PostgREST expresa "no vacío" sin mandar un valor vacío por
    // la URL: `_%` es "al menos un carácter", y un NULL tampoco casa con el
    // patrón, así que este filtro solo hace el trabajo de los dos.
    .ilike("telefono", "_%")

  // Si la cuenta falla se devuelve null y el panel no pinta nada. Un 0 sería
  // una mentira tranquilizadora: "no hay nada esperando".
  if (error || count === null) return null
  return count
}

/**
 * La cola de leads de demanda sin dueño.
 *
 * Mismos filtros que `repartir_leads_pendientes()`. El `.or(...)` de la fuente
 * no es un capricho: la RPC usa `fuente IS DISTINCT FROM 'Captaciones'`, que
 * SÍ incluye los leads sin fuente, mientras que un `neq` de PostgREST se
 * traduce a `fuente <> 'Captaciones'`, que los deja fuera porque en SQL
 * cualquier comparación con NULL es NULL. Serían dos números distintos para la
 * misma cola.
 */
async function contarLeadsPendientes(supabase: Supa): Promise<number | null> {
  const { count, error } = await supabase.from("leads")
    .select("id", { count: "exact", head: true })
    .is("agente_id", null)
    .is("duplicado_de", null)
    .is("captacion_id", null)
    .or("fuente.is.null,fuente.neq.Captaciones")

  if (error || count === null) return null
  return count
}

/**
 * Lo que lleva abierto cada agente, contado EN LA BASE y sobre `v_mi_dia`.
 *
 * Son dos decisiones que van juntas:
 *
 *   · El número lo da Postgres (`count: exact`, `head: true`), no un `.length`
 *     sobre filas traídas. Antes esto se hacía pidiendo la columna `agente_id`
 *     de todas las captaciones abiertas y contándolas aquí en un Map: con 737
 *     colaba de milagro, porque PostgREST corta en 1.000 filas sin avisar y con
 *     un 200 OK, así que el día que se pasara de mil la carga de los últimos
 *     agentes habría salido tranquilamente a cero.
 *
 *   · Y se cuentan las dos cosas sobre `v_mi_dia`, que es LA MISMA vista que el
 *     agente abre por la mañana, en vez de repetir aquí sus filtros. Repetirlos
 *     traía dos problemas y los dos estaban puestos:
 *
 *       - la lista de estados cerrados ('No_Interesado', 'Sin_Telefono',
 *         'Sin_WhatsApp', 'Duplicado', 'Traspaso') estaba escrita a mano en
 *         este fichero. Los estados de WhatsApp son un catálogo que el dueño
 *         edita en /configuracion/catalogos: el día que añada uno nuevo aquí no
 *         viene nadie a actualizar la lista.
 *
 *       - y, peor, `estado_whatsapp NOT IN (...)` DEJA FUERA a las que lo
 *         tienen a NULL, porque en SQL una comparación con NULL no es cierta.
 *         NULL es justamente el estado de una captación recién scrapeada: la
 *         migración 003 le quitó el DEFAULT a propósito para que la cola de
 *         envío las encuentre con `estado_whatsapp=is.null`. O sea que toda
 *         captación asignada y todavía sin contactar desaparecía de la carga, y
 *         el agente que más tuviera de ésas parecía el más libre del equipo.
 *
 * Así el número del panel es, por construcción, el mismo que ve el agente en su
 * pantalla, y no hay una segunda copia de la regla esperando a separarse.
 */
async function cargaPorAgente(
  supabase: Supa,
  ids: string[]
): Promise<Map<string, { captaciones: number | null; leads: number | null }>> {
  const filas = await Promise.all(ids.map(async (id) => {
    const base = () => supabase.from("v_mi_dia")
      .select("id", { count: "exact", head: true })
      .eq("agente_id", id)

    const [cap, lead] = await Promise.all([
      // Todo lo que NO es un lead, y no `ambito = 'captacion'` a secas: al
      // promocionar una captación (la RPC de la 022) la fila sale del ámbito
      // 'captacion' y entra en 'prospecto'. Contando sólo las captaciones, al
      // agente que hace avanzar las suyas le BAJA la carga justo cuando más
      // trabajo tiene encima, y el turno le manda todavía más. Dicho en
      // negativo, además, un cuarto ámbito futuro contaría como carga en vez de
      // desaparecer del panel sin que nadie se entere.
      base().neq("ambito", "lead"),
      base().eq("ambito", "lead"),
    ])

    // null y no 0, por lo mismo que en las colas: un cero al lado de un nombre
    // se lee como "éste está libre" y el dueño reordenaría el turno por un dato
    // que en realidad no se pudo leer.
    return [id, {
      captaciones: cap.error || cap.count === null ? null : cap.count,
      leads: lead.error || lead.count === null ? null : lead.count,
    }] as const
  }))

  return new Map(filas)
}

/** Todo lo que necesita el panel de reparto, de una vez. */
export async function getEstadoAsignacion(): Promise<EstadoAsignacion> {
  const sesion = await sesionActual()
  // Esto es un fichero "use server": cada export es un endpoint que cualquiera
  // con sesión puede llamar desde el navegador, lo pida o no la pantalla. La
  // página de captaciones sólo llama a esto si eres administrador, pero eso es
  // lo que se ENSEÑA, no lo que se permite. Sin esta línea, un agente se baja la
  // plantilla entera —nombres, zonas, disponibilidad y la carga de todos sus
  // compañeros— con una petición a mano.
  if (!sesion.isAdmin) throw new Error("Sólo el administrador ve el reparto")

  const supabase = await createAdminClient()

  const ajustes = await leerAjustes(supabase)

  // El error NO se tira a la basura: sin él, un fallo de red aquí llega al panel
  // como una plantilla vacía, indistinguible de "no hay ningún agente".
  const { data: perfiles, error: errorPerfiles } = await supabase.from("perfiles")
    .select("id, nombre, apellidos, rol, disponible, orden_reparto, zonas, especialidades")
    .neq("rol", "Admin")

  // La carga necesita los ids, así que va después; las dos colas no dependen de
  // nadie y se piden a la vez.
  const [carga, captacionesPendientes, leadsPendientes] = await Promise.all([
    cargaPorAgente(supabase, (perfiles ?? []).map((p) => p.id as string)),
    contarCaptacionesPendientes(supabase),
    contarLeadsPendientes(supabase),
  ])

  const agentes = (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: `${p.nombre} ${p.apellidos ?? ""}`.trim(),
    disponible: p.disponible ?? true,
    orden_reparto: p.orden_reparto,
    zonas: p.zonas ?? [],
    especialidades: p.especialidades ?? [],
    captacionesAbiertas: carga.get(p.id)?.captaciones ?? null,
    leadsAbiertos: carga.get(p.id)?.leads ?? null,
  })).sort((a, b) => (a.orden_reparto ?? 999) - (b.orden_reparto ?? 999))

  return { ...ajustes, agentes, agentesLeidos: !errorPerfiles, captacionesPendientes, leadsPendientes }
}

/** Asignación a mano. */
export async function asignarAMano(ids: number[], agenteId: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }
  if (ids.length === 0) return { error: "No has seleccionado ninguna captación" }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("captaciones").update({
    agente_id: agenteId,
    asignado_en: new Date().toISOString(),
    asignado_por: sesion.userId,
    asignacion_motivo: `A mano por ${sesion.nombre}`,
    // Se marca como no vista para que le salte el aviso al agente.
    visto_en: null,
  }).in("id", ids)

  if (error) return { error: error.message }
  revalidarCaptaciones()
  return { ok: true }
}

/** Repartir una tanda por turno, sin necesidad de encender el modo automático. */
export async function repartirPorTurno(ids: number[]): Promise<{ ok?: true; repartidas?: number; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }
  if (ids.length === 0) return { error: "No has seleccionado ninguna captación" }

  const supabase = await createAdminClient()

  // Una a una a propósito: cada llamada avanza el cursor, así que la tanda rota
  // de verdad en vez de caerle entera al mismo agente.
  let repartidas = 0
  let ultimoMotivo = ""
  for (const id of ids) {
    const { data, error } = await supabase.rpc("asignar_captacion", { p_captacion_id: id })
    if (error) return { error: error.message }
    const fila = (Array.isArray(data) ? data[0] : data) as { agente_id: string | null; motivo: string } | undefined
    if (fila?.agente_id) repartidas++
    else ultimoMotivo = fila?.motivo ?? ""
  }

  if (repartidas === 0) {
    return { error: ultimoMotivo || "No hay ningún agente disponible en la rotación" }
  }

  revalidarCaptaciones()
  return { ok: true, repartidas }
}

/**
 * Repartir el atasco de captaciones sin agente.
 *
 * Los ids se buscan en el servidor y no se mandan desde el navegador: son
 * cientos, y una lista así viajando en cada clic es tan frágil como innecesaria.
 * El tope existe para que una sola pulsación no reparta novecientas de golpe sin
 * que nadie pueda mirar el resultado antes de seguir.
 */
export async function repartirPendientes(tope = 50): Promise<{ ok?: true; repartidas?: number; quedan?: number | null; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte captaciones" }

  const supabase = await createAdminClient()

  // Sólo las que tienen señal, o sea aquéllas en las que la IA entendió interés
  // en lo que contestó el propietario. Haber contestado no basta, y una
  // captación recién scrapeada es un anuncio al que nadie ha escrito todavía:
  // repartirla es dar trabajo que no existe y desordenar el turno de todos por
  // nada.
  //
  // El reparto entero se hace en la base con repartir_interesadas_pendientes():
  // filtra, ordena por quien lleva más esperando y mueve el cursor del turno de
  // forma atómica. Hacerlo aquí a base de consultas dejaría el cursor a medias
  // si algo falla por el camino.
  const { data, error } = await supabase
    .rpc("repartir_interesadas_pendientes", { p_tope: Math.min(Math.max(1, tope), 200) })
    .maybeSingle<{ repartidas: number; sin_agente: number }>()

  if (error) return { error: error.message }

  const repartidas = data?.repartidas ?? 0
  const sinAgente = data?.sin_agente ?? 0

  if (repartidas === 0) {
    return sinAgente > 0
      ? { error: `Hay ${sinAgente} captaciones con señal esperando, pero ningún agente disponible para cogerlas` }
      : { error: "No hay ninguna captación con señal sin asignar" }
  }

  // Lo que queda se cuenta con el mismo filtro que usa la RPC: antes se contaba
  // aquí con uno propio y algo más flojo, así que el "quedan N" del aviso no
  // cuadraba con lo que el botón repartiría en la siguiente pulsada.
  const quedan = await contarCaptacionesPendientes(supabase)

  revalidarCaptaciones()
  return { ok: true, repartidas, quedan }
}

/**
 * Lo mismo, con los leads de demanda: los de Instagram y los de la ficha de una
 * propiedad.
 *
 * Es una función aparte y no un parámetro de `repartirPendientes` porque lo que
 * se reparte y CUÁNDO se reparte no se parecen en nada (ver la cabecera del
 * fichero). Lo único que comparten es la rotación, y ésa vive en la base.
 *
 * El tope existe por lo mismo que en captaciones: que una sola pulsación no
 * reparta ciento treinta y seis de golpe sin que nadie pueda mirar cómo han
 * caído antes de seguir.
 */
export async function repartirLeadsPendientes(tope = 50): Promise<{ ok?: true; repartidos?: number; quedan?: number | null; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte leads" }

  const supabase = await createAdminClient()

  // Todo el reparto pasa dentro de `repartir_leads_pendientes()`: elige, ordena
  // por quien lleva más esperando y mueve el cursor del turno de forma atómica.
  // Hacerlo aquí a base de consultas sueltas dejaría el cursor a medias si algo
  // se cae por el camino, y el turno descuadrado para siempre.
  const { data, error } = await supabase
    .rpc("repartir_leads_pendientes", { p_tope: Math.min(Math.max(1, tope), 200) })
    .maybeSingle<{ repartidos: number; sin_agente: number }>()

  if (error) return { error: error.message }

  const repartidos = data?.repartidos ?? 0
  const sinAgente = data?.sin_agente ?? 0

  if (repartidos === 0) {
    return sinAgente > 0
      ? { error: `Hay ${sinAgente} leads esperando, pero ningún agente disponible para cogerlos` }
      : { error: "No hay ningún lead de demanda sin asignar" }
  }

  const quedan = await contarLeadsPendientes(supabase)

  revalidatePath("/leads")
  revalidatePath("/contactos")
  // El panel de reparto vive dentro de la configuración de captaciones, y la
  // lista del día del agente, en su pantalla de inicio.
  revalidatePath("/captaciones")
  revalidatePath("/dashboard")
  return { ok: true, repartidos, quedan }
}

/**
 * Asignación de leads a mano.
 *
 * Los ids son uuid en texto, no bigint como en captaciones: el mismo nombre de
 * función con otro tipo de id sería una trampa esperando a que alguien pase un
 * number sin darse cuenta, así que van separadas.
 */
export async function asignarLeadsAMano(ids: string[], agenteId: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador reparte leads" }
  if (ids.length === 0) return { error: "No has seleccionado ningún lead" }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("leads").update({
    agente_id: agenteId,
    asignado_en: new Date().toISOString(),
    asignado_por: sesion.userId,
    asignacion_motivo: `A mano por ${sesion.nombre}`,
    // `captado_por` NO se toca, ni aquí ni en ningún otro sitio: ése es quién
    // TRAJO el lead y no cambia nunca; `agente_id` es quién lo trabaja hoy y se
    // traspasa. Pisar el primero borraría de dónde salió cada contacto, que es
    // justo el enredo que vino a deshacer la migración 024.
    //
    // Tampoco hay `visto_en` que limpiar: esa columna es de captaciones. En
    // leads, lo que hace saltar el aviso es que no estén atendidos.
  }).in("id", ids)

  if (error) return { error: error.message }

  revalidatePath("/leads")
  revalidatePath("/contactos")
  revalidatePath("/captaciones")
  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * Un agente rechaza un lead: vuelve a la cola y no se le vuelve a ofrecer.
 *
 * Igual que en captaciones, se apunta QUIÉN lo rechazó y no sólo que fue
 * rechazado: `siguiente_agente()` excluye a los que están en `rechazado_por`,
 * y sin eso la siguiente vuelta de la rotación se lo devolvería al mismo.
 */
export async function rechazarLead(id: string, motivo?: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: lead } = await supabase
    .from("leads").select("agente_id, rechazado_por").eq("id", id).maybeSingle()
  if (!lead) return { error: "Ese lead ya no existe" }
  if (!sesion.isAdmin && lead.agente_id !== sesion.userId) {
    return { error: "Ese lead no es tuyo" }
  }

  const yaRechazaron = new Set<string>(lead.rechazado_por ?? [])
  if (lead.agente_id) yaRechazaron.add(lead.agente_id)

  const { error } = await supabase.from("leads").update({
    agente_id: null,
    asignado_en: null,
    asignado_por: null,
    asignacion_motivo: `Rechazado por ${sesion.nombre}${motivo?.trim() ? `: ${motivo.trim()}` : ""}`,
    rechazado_por: [...yaRechazaron],
  }).eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/leads")
  revalidatePath("/contactos")
  revalidatePath("/captaciones")
  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * Un agente rechaza una captación: vuelve al pool y no se le vuelve a ofrecer.
 *
 * Se apunta quién la rechazó, no sólo que fue rechazada: si no, la siguiente
 * vuelta de la rotación se la devolvería al mismo.
 */
export async function rechazarCaptacion(id: number, motivo?: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  const supabase = await createAdminClient()

  const { data: cap } = await supabase
    .from("captaciones").select("agente_id, rechazado_por").eq("id", id).maybeSingle()
  if (!cap) return { error: "Esa captación ya no existe" }
  if (!sesion.isAdmin && cap.agente_id !== sesion.userId) {
    return { error: "Esa captación no es tuya" }
  }

  const yaRechazaron = new Set<string>(cap.rechazado_por ?? [])
  if (cap.agente_id) yaRechazaron.add(cap.agente_id)

  const { error } = await supabase.from("captaciones").update({
    agente_id: null,
    asignado_en: null,
    asignado_por: null,
    asignacion_motivo: `Rechazada por ${sesion.nombre}${motivo?.trim() ? `: ${motivo.trim()}` : ""}`,
    rechazado_por: [...yaRechazaron],
  }).eq("id", id)

  if (error) return { error: error.message }
  // Rechazar también deja el `agente_id` a NULL, y el trigger de la 026 se lo
  // quita igualmente al lead espejo: hay que refrescar las mismas pantallas.
  revalidarCaptaciones()
  return { ok: true }
}

/** El interruptor manual/automático. */
export async function cambiarModo(modo: ModoAsignacion): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador cambia el modo de reparto" }

  const supabase = await createAdminClient()
  await guardarAjuste(supabase, "asignacion_modo", modo)
  revalidatePath("/captaciones")
  return { ok: true }
}

export async function cambiarReglas(reglas: Partial<ReglasAsignacion>): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador cambia las reglas" }

  const supabase = await createAdminClient()
  const ajustes = await leerAjustes(supabase)
  await guardarAjuste(supabase, "asignacion_reglas", { ...ajustes.reglas, ...reglas })
  revalidatePath("/captaciones")
  return { ok: true }
}

/**
 * Marcarse disponible o no.
 *
 * Un agente sólo puede cambiarse a sí mismo; el administrador, a cualquiera —
 * hace falta para el que se pone malo y no entra al CRM a marcarlo.
 */
export async function cambiarDisponibilidad(
  agenteId: string,
  disponible: boolean
): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin && agenteId !== sesion.userId) {
    return { error: "Sólo puedes cambiar tu propia disponibilidad" }
  }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("perfiles").update({ disponible }).eq("id", agenteId)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * Reordenar la rotación.
 *
 * Llega la lista entera de ids en el orden nuevo. Se escribe en dos pasadas
 * porque `orden_reparto` tiene índice único: asignar el 2 a quien va a ser el 1
 * mientras el 2 sigue ocupado reventaría. Primero se aparcan en negativo, que
 * ningún puesto real usa, y luego se bajan a su sitio.
 */
export async function reordenarRotacion(idsEnOrden: string[]): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador ordena la rotación" }

  const supabase = await createAdminClient()

  for (let i = 0; i < idsEnOrden.length; i++) {
    const { error } = await supabase.from("perfiles").update({ orden_reparto: -(i + 1) }).eq("id", idsEnOrden[i])
    if (error) return { error: error.message }
  }
  for (let i = 0; i < idsEnOrden.length; i++) {
    const { error } = await supabase.from("perfiles").update({ orden_reparto: i + 1 }).eq("id", idsEnOrden[i])
    if (error) return { error: error.message }
  }

  revalidatePath("/captaciones")
  return { ok: true }
}

/** Sacar a alguien de la rotación sin marcarlo como no disponible. */
export async function fueraDeRotacion(agenteId: string): Promise<{ ok?: true; error?: string }> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) return { error: "Sólo el administrador ordena la rotación" }

  const supabase = await createAdminClient()
  const { error } = await supabase.from("perfiles").update({ orden_reparto: null }).eq("id", agenteId)
  if (error) return { error: error.message }

  revalidatePath("/captaciones")
  return { ok: true }
}
