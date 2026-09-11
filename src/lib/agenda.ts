/**
 * Tipos y utilidades de la agenda.
 *
 * Aparte del fichero de acciones porque ese es "use server" y sólo puede
 * exportar funciones async; aquí viven las constantes y los ayudantes
 * síncronos que también usa el cliente.
 */

export type TipoEntrada = "cita" | "nota" | "recordatorio"

export interface EntradaAgenda {
  id: string
  titulo: string
  descripcion: string | null
  tipo: TipoEntrada
  fecha: string
  todo_el_dia: boolean
  agente_id: string | null
  creado_por: string | null
  completado: boolean
  created_at: string
}

export interface PersonaAgenda {
  id: string
  nombre: string
  esAdmin: boolean
}

export const TIPOS: Array<{ valor: TipoEntrada; etiqueta: string; color: string; punto: string }> = [
  { valor: "cita", etiqueta: "Cita", color: "text-violet-500", punto: "bg-violet-500" },
  { valor: "recordatorio", etiqueta: "Recordatorio", color: "text-amber-500", punto: "bg-amber-500" },
  { valor: "nota", etiqueta: "Nota", color: "text-cyan-500", punto: "bg-cyan-500" },
]

export function tipoDe(t: string) {
  return TIPOS.find((x) => x.valor === t) ?? TIPOS[0]
}

/** Clave de día en horario local: es la que agrupa el calendario. */
export function claveDia(d: Date | string): string {
  const f = typeof d === "string" ? new Date(d) : d
  const mes = String(f.getMonth() + 1).padStart(2, "0")
  const dia = String(f.getDate()).padStart(2, "0")
  return `${f.getFullYear()}-${mes}-${dia}`
}

/**
 * Las seis semanas que se pintan en la rejilla del mes. Empieza en lunes
 * —el calendario español— y no en domingo, que es lo que hace `getDay()` por
 * defecto y descoloca la primera columna.
 */
export function semanasDelMes(ancla: Date): Date[][] {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1)
  const desplazamiento = (primero.getDay() + 6) % 7
  const inicio = new Date(primero)
  inicio.setDate(primero.getDate() - desplazamiento)

  const semanas: Date[][] = []
  for (let s = 0; s < 6; s++) {
    const semana: Date[] = []
    for (let d = 0; d < 7; d++) {
      const dia = new Date(inicio)
      dia.setDate(inicio.getDate() + s * 7 + d)
      semana.push(dia)
    }
    semanas.push(semana)
  }
  return semanas
}

export const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"]

export function nombreMes(d: Date) {
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" })
}

export function horaDe(iso: string) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
}

export function esHoy(d: Date) {
  return claveDia(d) === claveDia(new Date())
}
