import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolverPermisos, type ModuloKey, type Permisos } from "@/types/database"

export interface Sesion {
  userId: string
  nombre: string
  rol: string
  isAdmin: boolean
  permisos: Permisos
}

/**
 * Perfil del usuario que hace la petición, ya con los permisos completados.
 * Todo lo que necesita una página para decidir qué enseñar, en una sola llamada.
 */
export async function sesionActual(): Promise<Sesion> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("nombre, rol, permisos")
    .eq("id", user.id)
    .single()

  if (!perfil) redirect("/login")

  return {
    userId: user.id,
    nombre: perfil.nombre,
    rol: perfil.rol,
    isAdmin: perfil.rol === "Admin",
    permisos: resolverPermisos(perfil.permisos),
  }
}

/**
 * Puerta de cada sección.
 *
 * Va en la propia página y no en el layout ni en el middleware: el layout de
 * (dashboard) se reutiliza entre rutas hermanas y no se vuelve a ejecutar al
 * navegar, así que una comprobación allí dejaría pasar a quien llegue desde otra
 * pantalla. Esconder el enlace en el menú tampoco es un control de acceso —
 * escribir la URL a mano basta para saltárselo.
 */
export async function exigirModulo(modulo: ModuloKey): Promise<Sesion> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin && !sesion.permisos[modulo]) redirect(`/sin-acceso?m=${modulo}`)
  return sesion
}

/** Secciones que no se conceden: o eres admin o no entras. */
export async function exigirAdmin(): Promise<Sesion> {
  const sesion = await sesionActual()
  if (!sesion.isAdmin) redirect("/sin-acceso?m=admin")
  return sesion
}

/**
 * El mismo control, para las ACCIONES en vez de para las páginas.
 *
 * Las de arriba redirigen, que es lo que quiere una pantalla. Una server action
 * llamada desde un botón necesita lo contrario: contestar que no y que el
 * navegador enseñe un aviso, sin sacar a nadie de donde está.
 *
 * POR QUÉ HACE FALTA. Esconder el botón con `isAdmin &&` no es un control de
 * acceso: las server actions son puntos de entrada de verdad, y quien tenga la
 * sesión abierta puede llamarlas sin pasar por el botón. Es el mismo argumento
 * que ya está escrito arriba sobre esconder el enlace del menú, aplicado a lo
 * que se ejecuta en vez de a lo que se ve.
 *
 * El rol se lee SIEMPRE de la base con la sesión del que llama, nunca de algo
 * que venga en los argumentos: un parámetro `isAdmin` lo escribe quien hace la
 * petición.
 */
export async function admiteAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: perfil } = await supabase
    .from("perfiles").select("rol").eq("id", user.id).single()
  return perfil?.rol === "Admin"
}

/**
 * El aviso que se le da a quien intenta algo que no le toca.
 *
 * Se comparte el MENSAJE y no el objeto, y no es un capricho: devolver una
 * constante `{ error }` de otro fichero rompe la unión que TypeScript deduce
 * del resto de `return` de la función, y las pantallas dejan de poder leer
 * `res.error` o `res.aviso`. Devolviendo `{ error: SIN_PERMISO }` en el sitio,
 * la forma sigue siendo la misma que cuando falla la base, y las pantallas que
 * ya hacen `if (res.error) { toast.error(res.error); return }` —que son todas—
 * lo tratan igual sin tocar una línea.
 */
export const SIN_PERMISO = "No tienes permiso para hacer esto."
