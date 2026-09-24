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
