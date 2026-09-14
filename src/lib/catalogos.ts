/**
 * Los catálogos editables del CRM.
 *
 * Hasta la migración 012 los estados, las fuentes y los tipos vivían repartidos
 * entre CHECK constraints de Postgres y listas escritas a mano en diecisiete
 * ficheros de este mismo proyecto. Añadir un estado costaba una migración y un
 * despliegue. Ahora son filas de `catalogos` y los edita el administrador.
 *
 * Este fichero es sólo la forma de los datos y lo que hace falta para pintarlos;
 * la lectura y la escritura están en `lib/actions/catalogos.ts`.
 */

export interface Catalogo {
  id: string
  tipo: string
  valor: string
  nombre: string
  color: string | null
  orden: number
  activo: boolean
  /** Los de sistema no se borran: hay código de n8n que escribe su `valor`. */
  sistema: boolean
}

export type TipoCatalogo =
  | "estado_lead"
  | "estado_whatsapp"
  | "fuente"
  | "tipo_agenda"
  | "motivo_perdida"
  | "etiqueta"
  | "zona"
  | "especialidad"

/**
 * Las listas que se enseñan en el panel, con el orden en que se enseñan.
 *
 * `bloqueado` marca las que el CRM y los workflows leen por su `valor`: se
 * pueden renombrar y recolorear, y se pueden añadir valores nuevos, pero borrar
 * uno de sistema rompería código que está corriendo. La base de datos lo impide
 * igualmente; esto es para que la interfaz lo explique antes de que alguien lo
 * intente.
 */
export const TIPOS: Array<{
  tipo: TipoCatalogo
  titulo: string
  descripcion: string
  bloqueado: boolean
}> = [
  {
    tipo: "estado_lead",
    titulo: "Estados del lead",
    descripcion: "Las columnas del pipeline, de Nuevo a Ganado o Perdido.",
    bloqueado: true,
  },
  {
    tipo: "etiqueta",
    titulo: "Etiquetas",
    descripcion: "Marcas libres que se ponen a un lead. Puede llevar varias a la vez.",
    bloqueado: false,
  },
  {
    tipo: "motivo_perdida",
    titulo: "Motivos de pérdida",
    descripcion: "Por qué se cerró un lead. Sin esto no se sabe si se pierden por precio o por no llamar.",
    bloqueado: false,
  },
  {
    tipo: "fuente",
    titulo: "Fuentes",
    descripcion: "De dónde entra cada lead. Las escriben los workflows al crearlo.",
    bloqueado: true,
  },
  {
    tipo: "estado_whatsapp",
    titulo: "Estados de WhatsApp",
    descripcion: "El estado de la conversación con un propietario en el captador.",
    bloqueado: true,
  },
  {
    tipo: "tipo_agenda",
    titulo: "Tipos de agenda",
    descripcion: "Cita, recordatorio o nota en el calendario del equipo.",
    bloqueado: true,
  },
  {
    tipo: "zona",
    titulo: "Zonas",
    descripcion: "Barrios y municipios. Se usan para repartir leads por zona.",
    bloqueado: false,
  },
  {
    tipo: "especialidad",
    titulo: "Especialidades",
    descripcion: "En qué trabaja cada agente. Se usan para repartir por especialidad.",
    bloqueado: false,
  },
]

/**
 * Los colores se guardan como nombre, no como hex.
 *
 * El panel tiene modo claro y oscuro, y un hex que se lee bien en uno se pierde
 * en el otro. Guardando el nombre, cada modo elige su tono.
 */
export const COLORES = [
  "slate", "gray", "sky", "cyan", "violet", "indigo",
  "emerald", "amber", "rose", "pink",
] as const

export type ColorCatalogo = (typeof COLORES)[number]

const CLASES: Record<string, string> = {
  slate:   "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
  gray:    "bg-gray-500/15 text-gray-600 dark:text-gray-300 border-gray-500/30",
  sky:     "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30",
  cyan:    "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30",
  violet:  "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
  indigo:  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  amber:   "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  rose:    "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
  pink:    "bg-pink-500/15 text-pink-600 dark:text-pink-300 border-pink-500/30",
}

/** Clases de la pastilla de un valor. Un color desconocido cae en gris. */
export function claseColor(color: string | null | undefined): string {
  return CLASES[color ?? ""] ?? CLASES.gray
}

/**
 * El punto de color suelto, para las listas donde no cabe la pastilla entera.
 *
 * El mapa está escrito entero a propósito. Tailwind busca las clases leyendo el
 * código fuente, así que una clase construida con plantilla —`bg-${c}-500`— no
 * la encuentra al compilar y la purga: en producción el punto saldría sin color.
 */
const PUNTOS: Record<string, string> = {
  slate: "bg-slate-500", gray: "bg-gray-500", sky: "bg-sky-500", cyan: "bg-cyan-500",
  violet: "bg-violet-500", indigo: "bg-indigo-500", emerald: "bg-emerald-500",
  amber: "bg-amber-500", rose: "bg-rose-500", pink: "bg-pink-500",
}

export function clasePunto(color: string | null | undefined): string {
  return PUNTOS[color ?? ""] ?? PUNTOS.gray
}

/**
 * El nombre visible de un valor guardado.
 *
 * Cae al propio valor si no está catalogado, en vez de enseñar un hueco: una
 * fila antigua con un estado que ya nadie usa tiene que seguir leyéndose.
 */
export function nombreDe(catalogos: Catalogo[], tipo: string, valor: string | null): string {
  if (!valor) return "—"
  return catalogos.find((c) => c.tipo === tipo && c.valor === valor)?.nombre ?? valor
}

export function colorDe(catalogos: Catalogo[], tipo: string, valor: string | null): string | null {
  if (!valor) return null
  return catalogos.find((c) => c.tipo === tipo && c.valor === valor)?.color ?? null
}

/** Los de una lista, activos y en orden. Lo que se ofrece en un desplegable. */
export function opcionesDe(catalogos: Catalogo[], tipo: string): Catalogo[] {
  return catalogos
    .filter((c) => c.tipo === tipo && c.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

/**
 * Convierte un nombre escrito a mano en una clave estable.
 *
 * "Financiación pendiente" -> "financiacion_pendiente". La clave es lo que se
 * guarda en las filas y no se vuelve a tocar; el nombre se puede cambiar cuantas
 * veces haga falta sin migrar nada.
 */
export function valorDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
}
