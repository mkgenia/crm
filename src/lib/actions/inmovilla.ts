"use server"

// OJO con el nombre: `createAdminClient` manda las cookies del usuario y la
// consulta se ejecuta como `authenticated`, con sus RLS puestas. Aquí hace
// falta el que va de verdad como service_role, porque `inmovilla_usuarios` no
// la puede leer nadie más: que quien pregunta sea administrador se comprueba
// en cada acción, arriba, con la sesión real.
import { createServiceClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"
import { revalidatePath } from "next/cache"

/**
 * Inmovilla, por su API REST.
 *
 * De momento sólo lo que hace falta para saber QUIÉN es quién: su campo
 * `keyagente` es un número suyo, y para que un prospecto suba a nombre de quien
 * lo captó hay que tener la correspondencia con nuestros perfiles.
 *
 * Dos cosas que su documentación no cuenta y que conviene no volver a
 * descubrir:
 *
 *   · `GET /usuarios/?id=<código>` EXISTE, aunque la documentación diga que no
 *     hay forma de consultar agentes y remita a soporte. Devuelve nombre,
 *     apellidos, email y si la cuenta está desactivada.
 *   · No se pueden pedir todos de golpe. Los códigos aparecen en bloque en
 *     `GET /seguimientos/search/`, que es de dónde se sacan aquí.
 *
 * Y sus topes son bajos —seguimientos 20 por minuto, propiedades 10—, así que
 * la lista se guarda en `inmovilla_usuarios` y las pantallas leen de ahí. La
 * sincronización es manual y esporádica: no hay nada que mirar cada día.
 */

const BASE = "https://procesos.inmovilla.com/api/v1"

/** Entre llamada y llamada al pedir usuarios uno a uno. */
const RESPIRO_MS = 3_500

function token() {
  const t = process.env.INMOVILLA_TOKEN
  // El token caduca solo tras tres meses sin actividad, así que "no está
  // configurado" y "ha caducado" son dos fallos distintos y se dicen distinto.
  if (!t) throw new Error("Falta INMOVILLA_TOKEN en el entorno")
  return t
}

async function pedir(ruta: string): Promise<unknown> {
  const r = await fetch(BASE + ruta, {
    headers: { "Content-Type": "application/json", Token: token() },
    cache: "no-store",
  })
  if (r.status === 408) throw new Error("Inmovilla está limitando las peticiones. Prueba dentro de un minuto.")
  if (!r.ok) throw new Error(`Inmovilla ha contestado ${r.status}`)
  return r.json()
}

export interface UsuarioInmovilla {
  id: number
  usuario: string | null
  nombre: string | null
  apellidos: string | null
  email: string | null
  desactivado: boolean
}

/**
 * Los usuarios de Inmovilla que ya conocemos, para el desplegable.
 *
 * Sale de nuestra copia y no de su API: el formulario de invitar se abre muchas
 * veces y su endpoint va uno a uno. Los desactivados se quedan fuera salvo que
 * alguien los tenga ya enlazados, que si no desaparecería la cuenta de su ficha.
 */
export async function getUsuariosInmovilla(): Promise<UsuarioInmovilla[]> {
  const { isAdmin } = await sesionActual()
  if (!isAdmin) return []

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("inmovilla_usuarios")
    .select("id, usuario, nombre, apellidos, email, desactivado")
    .order("nombre")

  if (error) throw new Error(error.message)
  return (data ?? []) as UsuarioInmovilla[]
}

/**
 * Refresca la lista preguntándole a Inmovilla.
 *
 * Mira los seguimientos de los últimos treinta días para descubrir qué códigos
 * de agente están en uso, y de cada uno que no conozcamos pide su ficha. Los
 * que ya tenemos no se vuelven a pedir: son 3,5 segundos de espera cada uno.
 */
export async function sincronizarUsuariosInmovilla(): Promise<{
  nuevos: number
  conocidos: number
  error?: string
}> {
  const { isAdmin } = await sesionActual()
  if (!isAdmin) return { nuevos: 0, conocidos: 0, error: "No autorizado" }

  const supabase = createServiceClient()

  try {
    const hasta = new Date()
    const desde = new Date(hasta.getTime() - 30 * 86_400_000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)

    const seg = await pedir(`/seguimientos/search/?fechaalta_desde=${iso(desde)}&fechaalta_hasta=${iso(hasta)}`)
    const codigos = [...new Set(
      (Array.isArray(seg) ? seg : [])
        .map((s) => Number((s as { keyagente?: unknown }).keyagente))
        .filter((n) => Number.isInteger(n) && n > 0),
    )]

    const { data: yaEstan } = await supabase.from("inmovilla_usuarios").select("id")
    const conocidos = new Set((yaEstan ?? []).map((u) => (u as { id: number }).id))
    const faltan = codigos.filter((c) => !conocidos.has(c))

    let nuevos = 0
    for (const id of faltan) {
      const ficha = await pedir(`/usuarios/?id=${id}`)
      const u = (Array.isArray(ficha) ? ficha[0] : ficha) as Record<string, unknown> | undefined
      // Hay códigos con actividad cuya ficha ya no existe: gente dada de baja
      // hace tiempo. Se saltan en silencio; volver a pedirlos cada vez costaría
      // una llamada por sincronización para siempre.
      if (u && u.id) {
        await supabase.from("inmovilla_usuarios").upsert({
          id: Number(u.id),
          usuario: (u.user as string) ?? null,
          nombre: (u.nombre as string) ?? null,
          apellidos: (u.apellidos as string) ?? null,
          email: (u.email as string) ?? null,
          telefono: (u.telefono1 as string) ?? null,
          desactivado: Number(u.desactivar ?? 0) === 1,
          visto_en: new Date().toISOString(),
        })
        nuevos++
      }
      await new Promise((r) => setTimeout(r, RESPIRO_MS))
    }

    revalidatePath("/equipo")
    return { nuevos, conocidos: conocidos.size }
  } catch (e) {
    return { nuevos: 0, conocidos: 0, error: e instanceof Error ? e.message : "No se ha podido hablar con Inmovilla" }
  }
}

/**
 * Enlazar (o desenlazar) un perfil del CRM con una cuenta de Inmovilla.
 *
 * `null` desenlaza. El índice único de la migración 039 impide que dos perfiles
 * apunten a la misma cuenta: si lo permitiéramos, un prospecto podría acabar
 * subiendo a nombre de quien no lo captó.
 */
export async function asignarCuentaInmovilla(
  perfilId: string,
  inmovillaId: number | null,
): Promise<{ ok?: true; error?: string }> {
  const { isAdmin } = await sesionActual()
  if (!isAdmin) return { error: "No autorizado" }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("perfiles")
    .update({ inmovilla_agente_id: inmovillaId })
    .eq("id", perfilId)

  if (error) {
    // El mensaje de Postgres para un índice único no se entiende: se traduce.
    if (error.code === "23505") return { error: "Esa cuenta de Inmovilla ya está enlazada con otra persona" }
    return { error: error.message }
  }

  revalidatePath("/equipo")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// EL SALTO A INMOVILLA
// ---------------------------------------------------------------------------

/**
 * De la operación de Idealista a la de Inmovilla, por NOMBRE y no por número.
 *
 * El número se busca después en `inmovilla_enums`: si algún día cambian sus
 * códigos, basta con volver a bajarlos y esto sigue valiendo. Los nombres, en
 * cambio, son los que se leen en su panel y no se mueven.
 */
const OPERACION: Record<string, string> = { sale: "1. Venta", rent: "2. Alquiler" }

/** Y del tipo de vivienda de Idealista al suyo. */
const TIPO: Record<string, string> = {
  flat: "Piso",
  penthouse: "Ático",
  studio: "Estudio",
  duplex: "Dúplex",
  chalet: "Chalet",
  premise: "Local comercial",
  countryHouse: "Casa de campo",
}

/** Lo que se manda cuando no se sabe el tipo: la inmensa mayoría son pisos. */
const TIPO_POR_DEFECTO = "Piso"

const normalizar = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/ +/g, " ").trim()

/** "4ª" a 4, "bajo" a 0, cualquier otra cosa a null. */
function plantaComoNumero(p: unknown): number | null {
  const t = normalizar(p)
  if (!t) return null
  if (t.startsWith("bajo") || t === "bj") return 0
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Crear en Inmovilla la ficha de un prospecto nuestro.
 *
 * Se llama DESPUÉS de que la promoción haya terminado bien, nunca dentro de la
 * transacción: si Inmovilla está caído, el prospecto tiene que quedar creado
 * igualmente en el CRM. El fallo se guarda en `inmovilla_error` y la ficha
 * ofrece reintentar.
 *
 * Es idempotente por `propiedad_ref`: una ficha ya subida no se vuelve a crear.
 * Importa más de lo que parece — un alta con una referencia que ya existe no da
 * error en su API, ACTUALIZA la ficha que la tenga.
 */
export async function crearProspectoEnInmovilla(prospectoId: string): Promise<{
  ok?: true
  ref?: string
  yaEstaba?: true
  error?: string
}> {
  const { userId } = await sesionActual()
  if (!userId) return { error: "Se ha cerrado la sesión: vuelve a entrar" }

  const supabase = createServiceClient()

  const { data: pros, error: errPros } = await supabase
    .from("prospectos")
    .select(`
      id, propiedad_ref, captacion_id, operacion, tipo_inmueble,
      direccion, barrio, ciudad, precio, precio_salida, metros,
      habitaciones, banos, planta, tiene_ascensor, imagenes,
      captado_por, agente_id
    `)
    .eq("id", prospectoId)
    .maybeSingle()

  if (errPros) return { error: errPros.message }
  if (!pros) return { error: "Ese prospecto ya no existe" }
  if (pros.propiedad_ref) return { ok: true, yaEstaba: true, ref: pros.propiedad_ref }

  // El tipo de inmueble no lo copia `promocionar_captacion`, así que se lee de
  // la captación de la que vino: Idealista lo trae en `extendedPropertyType`.
  let tipoIdealista: string | null = null
  if (pros.captacion_id != null) {
    const { data: cap } = await supabase
      .from("captaciones").select("raw_data").eq("id", pros.captacion_id).maybeSingle()
    const raw = (cap?.raw_data ?? {}) as Record<string, unknown>
    tipoIdealista = typeof raw.extendedPropertyType === "string" ? raw.extendedPropertyType : null
  }

  // A nombre de quien lo captó; si esa persona no tiene cuenta enlazada, de
  // quien lo lleva. Sin ninguna de las dos, la ficha sube sin agente: es
  // preferible a no subirla.
  const personas = [pros.captado_por, pros.agente_id].filter(Boolean) as string[]
  let keyagente: number | null = null
  if (personas.length) {
    const { data: perfiles } = await supabase
      .from("perfiles").select("id, inmovilla_agente_id").in("id", personas)
    for (const quien of personas) {
      const p = (perfiles ?? []).find((x) => (x as { id: string }).id === quien) as
        { inmovilla_agente_id: number | null } | undefined
      if (p?.inmovilla_agente_id) { keyagente = p.inmovilla_agente_id; break }
    }
  }

  // Los códigos suyos, de nuestra copia.
  const { data: enums } = await supabase
    .from("inmovilla_enums").select("tipo, valor, nombre, padre")
  const lista = (enums ?? []) as Array<{ tipo: string; valor: number; nombre: string; padre: number | null }>
  const codigo = (tipo: string, nombre: string | null, padre?: number | null) => {
    if (!nombre) return null
    const n = normalizar(nombre)
    const candidatos = lista
      .filter((e) => e.tipo === tipo && (padre == null || e.padre == null || e.padre === padre))
      // ORDENADOS, y no es cosmético. En Valencia hay 56 nombres de zona
      // REPETIDOS con dos códigos distintos —Benimaclet es 1052199 y 4106899, y
      // así medio barrio—. Sin un orden fijo, el mismo barrio podría irse a un
      // código un día y a otro al siguiente. Sus propias fichas usan casi
      // siempre el más bajo, así que se elige ése.
      //
      // "Casi siempre": en la muestra, Vara de Quart usa el alto. Lo definitivo
      // será aprender de su cartera qué código usa cada nombre; mientras tanto,
      // una zona mal elegida se corrige a mano en Inmovilla y no rompe nada.
      .sort((a, b) => a.valor - b.valor)
    // Exacto primero. "Russafa" está también como "Russafa - Ruzafa" y la buena
    // es la que se llama igual que el barrio.
    return (candidatos.find((e) => normalizar(e.nombre) === n)
      ?? candidatos.find((e) => normalizar(e.nombre).startsWith(n)))?.valor ?? null
  }

  const keyacci = codigo("keyacci", OPERACION[pros.operacion ?? "sale"] ?? OPERACION.sale)
  const key_tipo = codigo("key_tipo", TIPO[tipoIdealista ?? ""] ?? pros.tipo_inmueble ?? TIPO_POR_DEFECTO)
    ?? codigo("key_tipo", TIPO_POR_DEFECTO)
  const key_loca = codigo("key_loca", pros.ciudad ?? "Valencia")
  const key_zona = codigo("key_zona", pros.barrio, key_loca)

  if (!keyacci || !key_tipo || !key_loca) {
    const falta = [!keyacci && "la operación", !key_tipo && "el tipo de inmueble", !key_loca && "la localidad"]
      .filter(Boolean).join(", ")
    const error = `No se puede subir: Inmovilla no reconoce ${falta}`
    await supabase.from("prospectos").update({ inmovilla_error: error }).eq("id", prospectoId)
    return { error }
  }

  // La referencia la da la base con su secuencia, no Node: dos promociones a la
  // vez pedirían el mismo número.
  const { data: refData, error: errRef } = await supabase.rpc("siguiente_ref_inmovilla")
  const ref = typeof refData === "string" ? refData : null
  if (errRef || !ref) return { error: "No se ha podido generar la referencia" }

  const ficha: Record<string, unknown> = {
    ref,
    keyacci,
    key_tipo,
    key_loca,
    key_zona,
    // Es una captación, no una propiedad publicada, y no disponible: es como
    // están sus más de seis mil prospectos.
    prospecto: true,
    nodisponible: true,
    calle: pros.direccion ?? null,
    planta: plantaComoNumero(pros.planta),
    // El precio de VENTA va en `precioinmo`. Mandarlo en `precio` devuelve un
    // 406 "El parametro precio no es valido", que no lo parece pero es eso.
    precioinmo: pros.precio_salida ?? pros.precio ?? null,
    m_cons: pros.metros ?? null,
    habitaciones: pros.habitaciones ?? null,
    banyos: pros.banos ?? null,
    ascensor: pros.tiene_ascensor === true ? 1 : 0,
  }
  if (keyagente) { ficha.keyagente = keyagente; ficha.captadopor = keyagente }
  const fotos = (pros.imagenes ?? []) as string[]
  if (fotos.length) ficha.fotos = fotos.map((url) => ({ url }))

  try {
    const r = await fetch(`${BASE}/propiedades/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Token: token() },
      body: JSON.stringify(ficha),
      cache: "no-store",
    })
    const cuerpo = await r.text()
    if (!r.ok) {
      // Sus mensajes se leen ("El parametro precio no es valido"), así que se
      // guardan tal cual: un genérico dejaría sin saber qué corregir.
      let detalle = cuerpo.slice(0, 200)
      try { detalle = (JSON.parse(cuerpo).mensaje as string) ?? detalle } catch {}
      const error = `Inmovilla no la ha aceptado: ${detalle}`
      await supabase.from("prospectos").update({ inmovilla_error: error }).eq("id", prospectoId)
      return { error }
    }

    // El alta SÍ devuelve el cod_ofer, aunque su documentación diga que no.
    let codOfer: number | null = null
    try { codOfer = Number(JSON.parse(cuerpo).cod_ofer) || null } catch {}

    await supabase.from("prospectos").update({
      propiedad_ref: ref,
      inmovilla_cod_ofer: codOfer,
      inmovilla_subido_en: new Date().toISOString(),
      inmovilla_error: null,
    }).eq("id", prospectoId)

    revalidatePath("/prospectos")
    return { ok: true, ref }
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se ha podido hablar con Inmovilla"
    await supabase.from("prospectos").update({ inmovilla_error: error }).eq("id", prospectoId)
    return { error }
  }
}
