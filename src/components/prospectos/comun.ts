import type { PersonaLinea } from "@/components/shared/linea-tiempo"

/**
 * Lo que comparten la lista de prospectos y su ficha: la forma de una fila, cómo
 * se lee lo que contesta el servidor y cómo se pintan euros y fechas.
 *
 * Un prospecto es la copia editable de una captación (migración 022): el piso
 * dejó de ser un anuncio ajeno de Idealista y pasó a ser algo que estamos
 * captando nosotros. Por eso aquí conviven dos personas —quien lo trajo y quien
 * lo trabaja hoy— y dos precios —el que pide el propietario y el que se acuerda
 * para publicar—, que son justo las cuatro cosas que un comercial mira primero.
 */

/** Una fila de prospecto con lo que estas pantallas necesitan. */
export interface Prospecto {
  id: string
  /** El lead canónico que hay detrás. Es la clave de su línea de tiempo. */
  contacto_id: string | null
  captacion_id: number | null
  estado: string
  direccion: string | null
  barrio: string | null
  ciudad: string | null
  /** Lo que pide el propietario. */
  precio: number | null
  /** Lo que se acuerda para publicar. */
  precio_salida: number | null
  descripcion: string | null
  /** Quien lo trajo. No se pisa nunca. */
  captado_por: string | null
  /** Quien lo trabaja hoy. Es lo que se traspasa. */
  agente_id: string | null
  atendido_en: string | null
  atendido_por: string | null
  created_at: string | null
  updated_at: string | null
  contacto_nombre: string | null
  contacto_telefono: string | null
}

/**
 * Lo que devuelve una acción del CRM se lee con estos tres ayudantes y no
 * desmontando el objeto a mano.
 *
 * Las acciones de este proyecto contestan de dos maneras: con los datos, o con
 * un `{ error }` en lugar de tirar. Leerlo así deja que la pantalla distinga
 * "no hay prospectos" de "no se ha podido leer la lista", que es la diferencia
 * entre una pantalla vacía honesta y una mentira.
 */
export function errorDe(respuesta: unknown): string | null {
  const e = (respuesta as { error?: unknown } | null | undefined)?.error
  if (typeof e === "string" && e.trim()) return e
  return e ? "No se ha podido completar la operación" : null
}

/**
 * El total de filas que cumplen el filtro, contado en la base de datos.
 *
 * `null` es "no se ha podido contar", y no es lo mismo que cero: un 0 en una
 * pastilla se lee como "aquí no hay nada" y hace que nadie vuelva a mirar.
 */
export function totalDe(respuesta: unknown): number | null {
  const t = (respuesta as { total?: unknown } | null | undefined)?.total
  return typeof t === "number" && Number.isFinite(t) ? t : null
}

function texto(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v : null
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return null
}

function numero(v: unknown): number | null {
  // `numeric` de Postgres puede llegar como número o como cadena según el
  // cliente; las dos formas valen y cualquier otra cosa es "no hay precio".
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * Un embebido de PostgREST llega como objeto o como array de uno según cómo
 * resuelva la relación. Aquí siempre es un contacto o ninguno.
 */
function unoSolo(v: unknown): Record<string, unknown> | null {
  const x = Array.isArray(v) ? v[0] : v
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null
}

/** Una fila cruda convertida en `Prospecto`, sin romperse por lo que falte. */
export function aProspecto(cruda: unknown): Prospecto | null {
  if (!cruda || typeof cruda !== "object") return null
  const f = cruda as Record<string, unknown>
  const id = texto(f.id)
  if (!id) return null

  // El nombre y el teléfono del propietario pueden venir embebidos con la fila o
  // ya planos. Se aceptan las dos formas para que la lista no se quede sin
  // teléfono —que es lo único que sirve para llamar— por cómo se pidieran.
  const contacto = unoSolo(f.contacto) ?? unoSolo(f.lead) ?? {}
  const nombre =
    texto(f.contacto_nombre) ??
    texto([texto(contacto.nombre), texto(contacto.apellidos)].filter(Boolean).join(" "))

  return {
    id,
    contacto_id: texto(f.contacto_id),
    captacion_id: numero(f.captacion_id),
    estado: texto(f.estado) ?? "",
    direccion: texto(f.direccion),
    barrio: texto(f.barrio),
    ciudad: texto(f.ciudad),
    precio: numero(f.precio),
    precio_salida: numero(f.precio_salida),
    descripcion: texto(f.descripcion),
    captado_por: texto(f.captado_por),
    agente_id: texto(f.agente_id),
    atendido_en: texto(f.atendido_en),
    atendido_por: texto(f.atendido_por),
    created_at: texto(f.created_at),
    updated_at: texto(f.updated_at),
    contacto_nombre: nombre,
    contacto_telefono: texto(f.contacto_telefono) ?? texto(contacto.telefono),
  }
}

/** Las filas de una respuesta de lista, ya normalizadas. */
export function filasDe(respuesta: unknown): Prospecto[] {
  const filas = (respuesta as { filas?: unknown } | null | undefined)?.filas
  if (!Array.isArray(filas)) return []
  return filas.map(aProspecto).filter((p): p is Prospecto => p !== null)
}

/** La fila de una respuesta de ficha, venga suelta o dentro de un sobre. */
export function filaDe(respuesta: unknown): Prospecto | null {
  if (!respuesta || typeof respuesta !== "object") return null
  const r = respuesta as Record<string, unknown>
  return aProspecto(r.prospecto ?? r.fila ?? r.data ?? r)
}

/**
 * Los precios se pintan sin decimales.
 *
 * Un piso son seis cifras: los céntimos sólo ensanchan la columna. `null` se
 * enseña como raya y no como "0 €", que se leería como un piso regalado.
 */
const EUROS = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})

export function euros(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? EUROS.format(v) : "—"
}

/**
 * Las fechas se formatean con locale y zona fijos.
 *
 * Esta pantalla se pinta primero en el servidor, que corre en UTC, y luego se
 * hidrata en el navegador, que está en Madrid: si cada uno usara la suya, el
 * mismo dato saldría con una hora distinta a cada lado y React lo cantaría como
 * desajuste. Numérico y no "14 sept" por lo mismo: el ICU de Node y el del
 * navegador no siempre abrevian igual los meses.
 */
export const FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Madrid",
})

export const FECHA_HORA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
})

/**
 * El reloj, tratado como lo que es: un sistema externo a React.
 *
 * "Atendido hace 3 días" sale de Date.now(), y esta lista se pinta en el
 * servidor antes de hidratarse aquí. Si el texto se calculara durante el render,
 * el HTML que llega y el que React produce al hidratar dirían cosas distintas
 * —entre uno y otro pasa tiempo, y los dos relojes ni siquiera van iguales— y
 * React lo cantaría como desajuste de hidratación. Leyéndolo con
 * useSyncExternalStore, el servidor y el primer render del cliente ven null y
 * enseñan la fecha absoluta, que sí es idéntica en los dos lados; ya hidratado,
 * React vuelve a renderizar con la hora de verdad. Mismo patrón, y por el mismo
 * motivo, que components/shared/linea-tiempo.tsx.
 */
export const RELOJ = {
  subscribe(alCambiar: () => void) {
    // Cada minuto, para que no envejezca a la vista de quien deja la ficha abierta.
    const t = setInterval(alCambiar, 60_000)
    return () => clearInterval(t)
  },
  // Redondeado al minuto a propósito: getSnapshot tiene que devolver lo mismo
  // mientras nada cambie, y un Date.now() crudo renderizaría sin parar.
  ahora: () => Math.floor(Date.now() / 60_000) * 60_000,
  enServidor: () => null,
}

/** Días naturales, no bloques de 24 h: a las 00:30 "ayer" tiene que ser ayer. */
function diasNaturales(antes: number, ahora: number): number {
  const a = new Date(antes)
  const b = new Date(ahora)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * Cuánto hace de esa fecha, en palabras.
 *
 * `ahora` a null es "todavía no hidratado": se devuelve la fecha absoluta, que
 * es idéntica en el servidor y en el navegador. Pasada una semana, "hace N
 * días" ya no sitúa a nadie y también se enseña la fecha.
 */
export function cuando(iso: string | null | undefined, ahora: number | null): string {
  if (!iso) return "—"
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return "—"
  if (ahora === null) return FECHA.format(ms)

  const seg = Math.round((ahora - ms) / 1000)
  // El reloj va redondeado al minuto, así que lo que se acaba de apuntar puede
  // caer unos segundos "en el futuro". Sólo lo futuro de verdad lleva fecha.
  if (seg < -120) return FECHA.format(ms)
  if (seg < 60) return "ahora mismo"
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = diasNaturales(ms, ahora)
  if (dias <= 1) return "ayer"
  if (dias < 7) return `hace ${dias} días`
  return FECHA.format(ms)
}

/** El nombre de un compañero por su id. Sin nadie detrás, "Sin asignar". */
export function nombreAgente(personas: PersonaLinea[], id: string | null): string {
  if (!id) return "Sin asignar"
  return personas.find((p) => p.id === id)?.nombre ?? "—"
}
