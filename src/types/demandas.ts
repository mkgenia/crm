export type EstadoDemanda = "Nuevo" | "Contactado" | "Cualificado" | "Descartado"

export const ESTADOS_DEMANDA: EstadoDemanda[] = ["Nuevo", "Contactado", "Cualificado", "Descartado"]

export const ESTADO_DEMANDA_CFG: Record<EstadoDemanda, { badge: string; dot: string; label: string }> = {
  Nuevo:       { badge: "bg-violet-500/10 text-violet-500 border-violet-500/20",    dot: "bg-violet-400",       label: "Nuevo" },
  Contactado:  { badge: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",          dot: "bg-cyan-400",         label: "Contactado" },
  Cualificado: { badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", dot: "bg-emerald-400",      label: "Cualificado" },
  Descartado:  { badge: "bg-muted text-muted-foreground border-border",             dot: "bg-muted-foreground", label: "Descartado" },
}

export const FUENTE_CFG: Record<string, string> = {
  Idealista:   "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  Fotocasa:    "bg-red-500/10 text-red-500 border-red-500/20",
  "Pisos.com": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Habitaclia:  "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Indomio:     "bg-purple-500/10 text-purple-500 border-purple-500/20",
}

export interface PropiedadDemanda {
  id: string
  ref: string
  tipo: string | null
  accion: string | null
  ciudad: string | null
  zona: string | null
  cp: string | null
  precio_alquiler: number
  precio_venta: number
  habitaciones: number
  banyos: number
  m_construidos: number
  titulo: string | null
  descripcion: string | null
  extras: string[]
  activo: boolean
  created_at: string
  updated_at: string
}

export interface Demanda {
  id: string
  propiedad_id: string
  nombre: string | null
  telefono: string | null
  email: string | null
  fuente: string | null
  mensaje: string | null
  estado: EstadoDemanda
  notas: string | null
  wa_jid: string | null
  datos_cualificacion: Record<string, unknown> | null
  visto: boolean
  fecha_creacion: string
}
