export type Rol = "Admin" | "Agente"

export interface Perfil {
  id: string
  nombre: string
  apellidos: string | null
  rol: Rol
  avatar_url: string | null
  telefono: string | null
  permisos: Permisos
  created_at: string
  usuario: string | null
}

/**
 * Una clave por sección del menú que un agente puede tener o no tener.
 *
 * El admin lo ve todo siempre: no se le pregunta a `permisos` por él. Y las
 * secciones de Automatización & IA no aparecen aquí a propósito — son de admin
 * por naturaleza, no algo que se conceda.
 */
export type ModuloKey =
  | "captaciones"
  | "reactivacion"
  | "galeria_rrss"
  | "galeria_qr"
  | "landings"
  | "leads"
  | "propiedades"
  | "prospectos"
  | "demandas"
  | "matches"
  | "mensajes"
  | "valorador"
  | "catalogos"

export type Permisos = Record<ModuloKey, boolean>

export interface Modulo {
  key: ModuloKey
  grupo: string
  label: string
  descripcion: string
}

/** Mismo orden y mismos nombres que el menú lateral: quien reparte permisos
 *  tiene que estar viendo lo que el agente verá, no una lista distinta. */
export const MODULOS: Modulo[] = [
  { key: "captaciones",  grupo: "Generador de leads", label: "Scraper",      descripcion: "Captaciones de Idealista y su WhatsApp" },
  { key: "reactivacion", grupo: "Generador de leads", label: "Reactivación", descripcion: "Recuperación de contactos antiguos" },
  { key: "galeria_rrss", grupo: "Generador de leads", label: "Galería RRSS", descripcion: "Piezas para redes sociales" },
  { key: "galeria_qr",   grupo: "Generador de leads", label: "Galería QR",   descripcion: "Códigos QR de escaparate y cartelería" },
  { key: "landings",     grupo: "Generador de leads", label: "Landings",     descripcion: "Páginas de captación" },
  { key: "leads",        grupo: "Inmobiliaria",       label: "Contactos",    descripcion: "Clientes potenciales y su seguimiento" },
  { key: "propiedades",  grupo: "Inmobiliaria",       label: "Propiedades",  descripcion: "Cartera de inmuebles" },
  { key: "prospectos",   grupo: "Inmobiliaria",       label: "Prospectos",   descripcion: "Propietarios en fase de captación" },
  { key: "demandas",     grupo: "Inmobiliaria",       label: "Demandas",     descripcion: "Peticiones de búsqueda de los clientes" },
  { key: "matches",      grupo: "Inmobiliaria",       label: "Matches",      descripcion: "Cruce entre demandas y cartera" },
  { key: "mensajes",     grupo: "Inmobiliaria",       label: "Mensajes",     descripcion: "Bandeja de entrada y WhatsApp" },
  { key: "valorador",    grupo: "Inmobiliaria",       label: "Valorador",    descripcion: "Informes de valoración de inmuebles" },
  { key: "catalogos",    grupo: "Organización",       label: "Catálogos",    descripcion: "Estados, etiquetas, fuentes y motivos del CRM" },
]

/**
 * Lo que ve un agente recién invitado. Se le da lo que hoy ya usa el equipo y
 * se le deja fuera lo que aún está en desarrollo: es más fácil abrir una puerta
 * cuando la sección exista que explicar por qué una página vacía aparece en el
 * menú de alguien que acaba de entrar.
 */
export const PERMISOS_DEFAULT: Permisos = {
  captaciones: true,
  reactivacion: false,
  galeria_rrss: false,
  galeria_qr: false,
  landings: false,
  leads: true,
  propiedades: false,
  prospectos: false,
  demandas: true,
  matches: false,
  mensajes: true,
  valorador: true,
  // Catálogos va cerrado. No es que un agente no pueda tenerlo, es que afecta
  // al trabajo de los demás: quien toca los catálogos renombra estados para los
  // seis a la vez. Eso se concede a dedo, no se hereda por ser agente.
  catalogos: false,
}

/**
 * El JSON guardado en `perfiles.permisos` casi nunca tiene todas las claves: los
 * perfiles creados antes de esta versión sólo llevan tres. Se completa con los
 * valores por defecto en vez de tratar "clave ausente" como "denegado", que
 * habría dejado a todo el equipo sin Demandas ni Valorador de un día para otro.
 */
export function resolverPermisos(raw: unknown): Permisos {
  const guardado = (raw ?? {}) as Partial<Record<ModuloKey, unknown>>
  const salida = {} as Permisos
  for (const m of MODULOS) {
    const valor = guardado[m.key]
    salida[m.key] = typeof valor === "boolean" ? valor : PERMISOS_DEFAULT[m.key]
  }
  return salida
}
