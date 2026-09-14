/**
 * Tipos del reparto de captaciones.
 *
 * Aquí no hay lógica a propósito. A quién le toca cada captación lo decide la
 * base de datos, en `siguiente_agente()` y el trigger de la migración 017, y
 * tiene que ser así porque las captaciones las crea el workflow de ingesta de
 * n8n escribiendo directo contra PostgREST, sin pasar por Next.
 *
 * Hubo una primera versión que implementaba la rotación aquí, en TypeScript, y
 * se probó con quince casos. Funcionaba — y no servía: en producción iba a
 * correr el SQL, así que aquellas pruebas validaban código que nunca se
 * ejecutaría. Dos implementaciones de la misma regla sólo garantizan que un día
 * se separen; se dejó la de SQL, que es la que corre, y se probó ésa contra la
 * base real.
 */

export interface AgenteReparto {
  id: string
  nombre: string
  /** Vacaciones, baja o fuera de turno: el motor lo salta. */
  disponible: boolean
  /** Su puesto en la rotación, empezando en 1. NULL = fuera del reparto. */
  orden_reparto: number | null
  zonas: string[]
  especialidades: string[]
}

export interface ReglasAsignacion {
  /** Filtrar por zona antes de rotar. */
  zona: boolean
  /** Filtrar por especialidad antes de rotar. */
  especialidad: boolean
  /** Si el teléfono ya lo llevó alguien, devolvérselo. */
  continuidad: boolean
}

export const REGLAS_POR_DEFECTO: ReglasAsignacion = {
  zona: false,
  especialidad: false,
  continuidad: true,
}
