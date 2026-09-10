/**
 * A quién se avisa cuando un propietario se interesa.
 *
 * Antes eran dos constantes escritas a mano: un correo dentro del nodo de email
 * y un teléfono dentro del generador del workflow. Cambiar de destinatario
 * obligaba a tocar y volver a subir el flujo, así que ahora vive en
 * `app_settings` y se configura desde el panel del captador.
 *
 * n8n lee esas dos claves en cada aviso. Si no existen todavía, cae en los
 * valores de siempre: nadie se queda sin avisar por no haber pasado por el panel.
 *
 * Este fichero está aparte del de acciones a propósito: un módulo "use server"
 * sólo puede exportar funciones async, y aquí hay constantes y validadores
 * síncronos que también usa el cliente.
 */

export const AVISO_EMAILS_DEFECTO = ["notificaciones@grupohogares.es"]
export const AVISO_TELEFONOS_DEFECTO = ["34673298925"]

/**
 * Deja el número como lo quiere Evolution: 34 y nueve dígitos, sin espacios ni
 * signos. Se aceptan las formas en que la gente escribe un móvil de verdad
 * (+34 612 34 56 78, 0034…, o los nueve dígitos sueltos) y se rechaza lo que no
 * sea un móvil español, porque a un fijo no le llega un WhatsApp.
 */
export function normalizarTelefono(v: string): string | null {
  let d = String(v ?? "").replace(/\D/g, "")
  if (d.startsWith("00")) d = d.slice(2)
  if (d.length === 9) d = "34" + d
  return /^34[6-9]\d{8}$/.test(d) ? d : null
}

export function normalizarEmail(v: string): string | null {
  const e = String(v ?? "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null
}

/** 34612345678 → +34 612 345 678, sólo para enseñarlo en pantalla. */
export function telefonoBonito(t: string): string {
  const m = /^34(\d{3})(\d{3})(\d{3})$/.exec(t)
  return m ? `+34 ${m[1]} ${m[2]} ${m[3]}` : t
}

export function comoLista(v: unknown, porDefecto: string[]): string[] {
  return Array.isArray(v) ? (v as string[]) : porDefecto
}
