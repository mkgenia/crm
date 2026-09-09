export type EstadoAgenda = "pendiente" | "completado" | "cancelado"
export type EstadoWhatsApp = "Pendiente" | "Enviado" | "Interesado" | "Quiere_Llamada" | "No_Interesado" | "Respondido" | "Sin_WhatsApp" | "Duplicado" | null
export type EstadoUnificado = "Nuevo" | "Contactado" | "Interesado" | "Propuesta" | "Negociacion" | "Ganado" | "Perdido"
export type EstadoCRM = EstadoUnificado
export type EstadoLead = EstadoUnificado

export const WA_CLASIFICACIONES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  Pendiente:     { bg: "bg-zinc-500/10",    text: "text-zinc-400",    dot: "bg-zinc-400",      label: "Pendiente" },
  Enviado:       { bg: "bg-violet-500/10",  text: "text-violet-500",  dot: "bg-violet-500",    label: "Enviado" },
  Respondido:    { bg: "bg-cyan-500/10",    text: "text-cyan-500",    dot: "bg-cyan-500",      label: "Respondido" },
  Interesado:    { bg: "bg-emerald-500/10", text: "text-emerald-500", dot: "bg-emerald-500",   label: "Interesado" },
  Quiere_Llamada: { bg: "bg-orange-500/10",  text: "text-orange-500",  dot: "bg-orange-500",    label: "Quiere llamada" },
  No_Interesado: { bg: "bg-red-500/10",     text: "text-red-500",     dot: "bg-red-500",       label: "No interesado" },
  Sin_WhatsApp:  { bg: "bg-amber-500/10",   text: "text-amber-500",   dot: "bg-amber-500",     label: "Sin WhatsApp" },
  Duplicado:     { bg: "bg-slate-500/10",   text: "text-slate-400",   dot: "bg-slate-400",     label: "Duplicado" },
}

/**
 * Estados desde los que el captador ya no actúa pero el agente sí puede reactivar
 * con el botón "Reintentar" del panel de detalle.
 *
 * "Pendiente" es el valor heredado de las 71 captaciones que nunca se contactaron:
 * quedan fuera de la cola automática a propósito, y desde aquí se meten una a una.
 */
export const WA_REINTENTABLES: string[] = ["Sin_WhatsApp", "Duplicado", "Pendiente"]

export interface Captacion {
  id: number
  created_at: string
  nombre: string | null
  telefono: string | null
  precio: number | null
  precio_m2: number | null
  barrio: string | null
  calle: string | null
  metros: number | null
  habitaciones: number | null
  banos: number | null
  planta: string | null
  tiene_ascensor: boolean | null
  estado: string | null
  estado_crm: EstadoCRM
  estado_whatsapp: EstadoWhatsApp
  descripcion: string | null
  url: string | null
  activo: boolean
  imagen_url: string | null
  imagenes: string[] | null
  // Captador automático (migración 003)
  contacto_lock_en: string | null      // reserva del auto-contacto; null = en cola
  ultimo_contacto_en: string | null
  fotos_procesadas: boolean
  precio_anterior: number | null
  precio_actualizado_en: string | null
  /**
   * "sale" | "rent", extraído de raw_data->>operation en la consulta.
   *
   * La tabla mezcla venta y alquiler y el captador les escribe cosas distintas, así
   * que el agente tiene que poder distinguirlas de un vistazo. No es una columna:
   * viaja como alias para no cargar el raw_data entero en el listado.
   */
  operacion: "sale" | "rent" | null
  agente_id: string | null
  fecha_agenda: string | null
  recordatorio_fecha: string | null
  notas_agenda: string | null
  estado_agenda: EstadoAgenda
  // joined
  agente?: {
    id: string
    nombre: string
    apellidos: string | null
    avatar_url: string | null
  } | null
}

export interface HistorialCambio {
  id: string
  captacion_id: number
  fecha: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
}

export const ESTADOS_CAPTACION: EstadoCRM[] = [
  "Nuevo",
  "Contactado",
  "Interesado",
  "Propuesta",
  "Negociacion",
  "Ganado",
  "Perdido",
]

export const ESTADO_LABELS: Record<EstadoUnificado, string> = {
  Nuevo:       "Nuevo",
  Contactado:  "Contactado",
  Interesado:  "Interesado",
  Propuesta:   "Propuesta",
  Negociacion: "Negociación",
  Ganado:      "Ganado",
  Perdido:     "Perdido",
}

export const ESTADO_COLORS: Record<string, { bg: string; text: string }> = {
  Nuevo:       { bg: "bg-violet-500/10",  text: "text-violet-500" },
  Contactado:  { bg: "bg-cyan-500/10",    text: "text-cyan-500" },
  Interesado:  { bg: "bg-blue-500/10",    text: "text-blue-500" },
  Propuesta:   { bg: "bg-orange-500/10",  text: "text-orange-500" },
  Negociacion: { bg: "bg-yellow-500/10",  text: "text-yellow-500" },
  Ganado:      { bg: "bg-emerald-500/10", text: "text-emerald-500" },
  Perdido:     { bg: "bg-muted",          text: "text-muted-foreground" },
}

export const AGENDA_COLORS: Record<EstadoAgenda, { bg: string; text: string; dot: string }> = {
  pendiente:  { bg: "bg-violet-500/10", text: "text-violet-500",  dot: "bg-violet-500" },
  completado: { bg: "bg-emerald-500/10", text: "text-emerald-500", dot: "bg-emerald-500" },
  cancelado:  { bg: "bg-red-500/10",    text: "text-red-500",     dot: "bg-red-500" },
}
