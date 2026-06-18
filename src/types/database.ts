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

export interface Permisos {
  leads: boolean
  mensajes: boolean
  captaciones: boolean
}

export const PERMISOS_DEFAULT: Permisos = {
  leads: true,
  mensajes: true,
  captaciones: true,
}

export const MODULOS = [
  { key: "leads" as const,       label: "Leads",       descripcion: "Gestión de contactos y clientes potenciales" },
  { key: "mensajes" as const,    label: "Mensajes",    descripcion: "Bandeja de entrada y WhatsApp" },
  { key: "captaciones" as const, label: "Captaciones", descripcion: "Gestión de inmuebles captados" },
]
