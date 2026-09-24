"use server"

import { createAdminClient } from "@/lib/supabase/server"
import { sesionActual } from "@/lib/auth/acceso"

/**
 * Los contactos: las personas, no los papeles.
 *
 * Un contacto NO es una tabla nueva. Es una fila de `leads` que ya ha pasado de
 * ser una pregunta suelta a ser alguien con quien la agencia tiene algo: la
 * marca es `leads.contacto_desde`, y la pone la base de datos sola dentro de
 * `promocionar_captacion()` cuando una captación salta a prospecto (paso 3 de
 * esa función). Por eso aquí no se escribe: esta pantalla LEE lo que ya decide
 * el salto, y así no hay dos sitios que puedan discrepar sobre quién es
 * contacto y quién no.
 *
 * Que sea la misma tabla es lo que hace que la rueda cierre sin costuras: el
 * lead que entró por Instagram, si acaba vendiendo su piso con nosotros, es la
 * misma fila —mismo teléfono, mismo historial, misma línea de tiempo— y no una
 * copia con la que luego haya que cuadrar nada.
 */

/** Lo que la lista y la ficha necesitan de cada persona. */
const COLUMNAS = `
  id, nombre, apellidos, telefono, email, fuente, estado, notas,
  fecha_creacion, contacto_desde, captacion_id, agente_id, captado_por,
  atendido_en, proximo_toque, proximo_motivo,
  agente:perfiles!leads_agente_id_fkey(id, nombre, apellidos),
  captador:perfiles!leads_captado_por_fkey(id, nombre, apellidos),
  prospectos:prospectos!prospectos_contacto_id_fkey(id, estado, direccion, barrio, precio, updated_at)
`

export interface FilaContacto {
  id: string
  nombre: string | null
  apellidos: string | null
  telefono: string | null
  email: string | null
  fuente: string | null
  estado: string | null
  notas: string | null
  fecha_creacion: string | null
  contacto_desde: string | null
  captacion_id: number | null
  agente_id: string | null
  captado_por: string | null
  atendido_en: string | null
  proximo_toque: string | null
  proximo_motivo: string | null
  prospectos: Array<{
    id: string
    estado: string | null
    direccion: string | null
    barrio: string | null
    precio: number | null
    updated_at: string | null
  }>
}

/**
 * Una página de contactos.
 *
 * El agente ve los suyos y el administrador los de todos. Quién eres sale de la
 * sesión y NUNCA de un parámetro: esto está exportado desde un fichero
 * "use server" y cualquiera puede llamarlo desde el navegador con lo que le
 * apetezca. Mismo criterio que `getProspectos`.
 *
 * El total se cuenta en la base (`count: "exact"`) y no sobre las filas
 * traídas, que dirían siempre el tamaño de la página: PostgREST corta en 1.000
 * con un 200 y sin avisar.
 */
export async function getContactos({
  search,
  conPiso,
  pagina = 1,
  porPagina = 50,
}: {
  search?: string
  /** Sólo los que tienen algún piso en captación (un prospecto). */
  conPiso?: boolean
  pagina?: number
  porPagina?: number
} = {}): Promise<{ filas: Record<string, unknown>[]; total: number }> {
  const { userId, isAdmin } = await sesionActual()
  const supabase = await createAdminClient()

  // El "sólo los que tienen piso" se resuelve en el propio embebido: `!inner`
  // hace que PostgREST descarte las filas sin ningún prospecto. Filtrarlo
  // después con `.not("prospectos", ...)` no funciona —el filtro no viaja al
  // embebido— y además hace que TypeScript se pierda en la relación.
  let query = supabase
    .from("leads")
    .select(
      conPiso
        ? COLUMNAS.replace("prospectos_contacto_id_fkey(", "prospectos_contacto_id_fkey!inner(")
        : COLUMNAS,
      { count: "exact" },
    )
    // La fecha en la que dejó de ser sólo un lead: lo último que ha pasado
    // arriba, que es como se mira una lista de personas.
    .not("contacto_desde", "is", null)
    // Un duplicado no es una persona más: la 019 lo deja apuntando al canónico.
    .is("duplicado_de", null)
    .order("contacto_desde", { ascending: false })

  if (!isAdmin) query = query.eq("agente_id", userId)

  if (search) {
    // Las comas y los paréntesis son la sintaxis del propio `.or()`: sin
    // quitarlos, teclear "Giner, Amparo" rompe la consulta entera.
    const q = search.replace(/[,()\\]/g, " ").trim()
    if (q) {
      query = query.or(
        `nombre.ilike.%${q}%,apellidos.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%`,
      )
    }
  }

  const tamano = Math.min(200, Math.max(1, Math.floor(porPagina) || 50))
  const desde = (Math.max(1, Math.floor(pagina) || 1) - 1) * tamano

  const { data, error, count } = await query.range(desde, desde + tamano - 1)
  if (error) throw new Error(error.message)
  return { filas: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0 }
}

/**
 * Cuántos contactos hay, y cuántos de ellos tienen ya un piso en captación.
 *
 * Las dos cuentas las hace la BASE DE DATOS con `head: true`: viajan los
 * contadores y ni una fila. La primera versión de esto se traía todos los
 * `prospectos.contacto_id` y los contaba aquí con un Set, y ése es el error
 * clásico de PostgREST: corta en 1.000 filas con un 200 OK y sin decir nada, así
 * que el día que haya mil prospectos el número se queda quieto para siempre.
 *
 * Un contador que falla vuelve como `null` y no como 0, porque un 0 se lee
 * como "aquí no hay nada" y hace que nadie vuelva a mirar.
 */
export async function getTotalesContactos(): Promise<{
  total: number | null
  conPiso: number | null
}> {
  const { userId, isAdmin } = await sesionActual()
  const supabase = await createAdminClient()

  const base = (select: string) => {
    let q = supabase
      .from("leads")
      .select(select, { count: "exact", head: true })
      .not("contacto_desde", "is", null)
      .is("duplicado_de", null)
    if (!isAdmin) q = q.eq("agente_id", userId)
    return q
  }

  const [todos, conPiso] = await Promise.all([
    base("id"),
    // `!inner` descarta las personas sin ningún prospecto, y el count lo hace
    // Postgres sobre el join: es la MISMA condición que usa la lista, así que la
    // pastilla y lo que se ve al pulsarla no pueden discrepar.
    base("id, prospectos!prospectos_contacto_id_fkey!inner(id)"),
  ])

  return {
    total: todos.error ? null : todos.count ?? 0,
    conPiso: conPiso.error ? null : conPiso.count ?? 0,
  }
}
