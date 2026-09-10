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
