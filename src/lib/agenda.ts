/**
 * Tipos y utilidades de la agenda.
 *
 * Aparte del fichero de acciones porque ese es "use server" y sólo puede
 * exportar funciones async; aquí viven las constantes y los ayudantes
 * síncronos que también usa el cliente.
 */

import { clasePunto, opcionesDe, type Catalogo } from "@/lib/catalogos"

/**
 * El tipo de una entrada, como TEXTO y no como unión cerrada.
 *
 * Antes aquí ponía `"cita" | "nota" | "recordatorio"`, y esa unión era una
 * lista de valores escrita a mano compitiendo con el catálogo `tipo_agenda`,
 * que es quien manda desde la migración 012: la tabla `agenda` ya no tiene
 * CHECK de tipos —lo quitó la 012:169— sino un trigger que valida contra el
 * catálogo (012:173). Por eso dar de alta "visita" en la tabla NO bastaba: el
 * desplegable no la ofrecía y una entrada de tipo visita se pintaba como "Cita"
 * por el `?? TIPOS[0]` que tenía `tipoDe` aquí abajo.
 *
 * Con `string` el valor nuevo entra solo. Y no se pierde ninguna comprobación:
 * la escritura la sigue rechazando Postgres si el valor no está catalogado, que
 * es donde tiene que comprobarse y no en el navegador.
 */
export type TipoEntrada = string

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

/**
 * Una entrada pasada de fecha y sin completar, con el "hace 4 meses" YA ESCRITO.
 *
 * El texto viaja hecho desde el servidor a propósito. Sale de `Date.now()`, y
 * calculado durante el render el servidor y el navegador escribirían cosas
 * distintas: React lo canta como desajuste de hidratación. Es el mismo trato
 * que la portada del agente le da a `toqueTexto` y `esperaTexto`.
 */
export interface EntradaVencida extends EntradaAgenda {
  desdeHaceTexto: string
}

export interface PersonaAgenda {
  id: string
  nombre: string
  esAdmin: boolean
}

/**
 * Las piezas de una fecha vistas desde MADRID. Sólo la usa `inicioDiaMadrid`.
 *
 * `en-CA` no es idioma: se leen las piezas una a una con `formatToParts`, así
 * que lo único que importa es que el formato pida las siete en 24 horas.
 */
const PARTES_MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid", hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

/**
 * El instante en que empieza (00:00 de MADRID) el día de `base`.
 *
 * NO vale cortar el día con `setHours(0, 0, 0, 0)`, que es la hora del
 * SERVIDOR. En producción el servidor va en UTC y Madrid va una o dos horas por
 * delante, y eso rompe justo el caso más común: una entrada de "todo el día" la
 * crea el navegador como `new Date("2026-09-16T00:00:00")` con la hora de
 * Madrid (agenda-panel.tsx:362), o sea que se guarda como 2026-09-15T22:00Z.
 * Cortando por la medianoche de UTC, la tarea de HOY caería del lado de ayer y
 * el bloque la cantaría como vencida un día antes de tiempo.
 *
 * Está copiada de la portada del agente —donde es privada de la página— por lo
 * mismo que `desdeHace`: allí no es una librería de la que se pueda importar.
 */
export function inicioDiaMadrid(base: Date): Date {
  const p: Record<string, string> = {}
  for (const parte of PARTES_MADRID.formatToParts(base)) p[parte.type] = parte.value
  // Con `hour12: false` algunas versiones de Node escriben la medianoche como
  // "24" en vez de "00"; sin esto el desfase saldría 24 h torcido esa hora.
  const hora = p.hour === "24" ? "00" : p.hour
  // El mismo reloj leído como si fuera UTC. No es una fecha de verdad: sólo
  // sirve para restar y saber cuánto va Madrid por delante de UTC ahora mismo.
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hora, +p.minute, +p.second)
  const desfase = comoUTC - base.getTime()
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - desfase)
}

/**
 * "hace 4 meses". Sólo se llama DESDE EL SERVIDOR (ver `EntradaVencida`).
 *
 * Está copiada de la portada del agente —donde es privada del módulo— en vez de
 * importada porque aquel fichero es una página, no una librería. Cuando haya un
 * sitio común para el tiempo, las dos se van allí.
 *
 * Se redondea a la baja sin pasar de "meses": una cita de hace medio año no se
 * lee mejor en años, y quien la tiene vencida ya ha entendido el mensaje.
 */
export function desdeHace(iso: string): string {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return "hace tiempo"

  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 2) return "hace un momento"
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias < 31) return `hace ${dias} ${dias === 1 ? "día" : "días"}`
  const meses = Math.floor(dias / 30)
  return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`
}

/** Un tipo de agenda listo para pintar: su nombre y sus clases de color. */
export interface TipoAgenda {
  valor: TipoEntrada
  etiqueta: string
  /** El color del catálogo POR SU NOMBRE ("emerald"), no una clase ni un hex. */
  color: string
  /** La clase del punto ya resuelta, que es lo que pintan las listas. */
  punto: string
}

const conColor = (valor: string, etiqueta: string, color: string): TipoAgenda =>
  ({ valor, etiqueta, color, punto: clasePunto(color) })

/**
 * EL RESPALDO, no la fuente de la verdad.
 *
 * Son los cuatro valores que sembraron la 012 y la 034 en `tipo_agenda`, con
 * sus mismos colores. Lo usan los sitios que todavía no reciben el catálogo
 * —la columna "Lo que viene" y la agenda del administrador— y las lecturas que
 * fallan: sin él esas listas se quedarían sin punto de color. Quien SÍ tiene el
 * catálogo a mano usa `tiposDesdeCatalogo`, y entonces esta lista no se mira.
 *
 * El orden es el del catálogo (cita 10 · visita 15 · recordatorio 20 · nota 30):
 * la visita cae justo después de la cita, que es donde la busca quien está
 * acostumbrado a poner citas.
 */
export const TIPOS: TipoAgenda[] = [
  conColor("cita", "Cita", "violet"),
  conColor("visita", "Visita", "emerald"),
  conColor("recordatorio", "Recordatorio", "amber"),
  conColor("nota", "Nota", "cyan"),
]

/**
 * Los tipos TAL Y COMO ESTÉN en /configuracion/catalogos: los activos, en su
 * orden, con el nombre y el color que tengan puestos hoy.
 *
 * Si el catálogo llegara vacío —lectura rota, o todo archivado— se devuelve el
 * respaldo: un desplegable sin una sola opción no deja apuntar nada.
 */
export function tiposDesdeCatalogo(catalogos: Catalogo[]): TipoAgenda[] {
  const del = opcionesDe(catalogos, "tipo_agenda")
  return del.length ? del.map((c) => conColor(c.valor, c.nombre, c.color ?? "gray")) : TIPOS
}

/**
 * El tipo de una entrada, para pintarla.
 *
 * Antes caía en `TIPOS[0]` cuando no encontraba el valor, y eso es justo lo que
 * hacía que una entrada de tipo "visita" se leyera como "Cita" —con su punto
 * violeta y todo— en cuanto el catálogo tuvo un valor que el código no conocía.
 * Ahora cae al propio valor en gris, igual que hacen `nombreDe` y `colorDe` con
 * los demás catálogos: un tipo recién creado o retirado se sigue leyendo por su
 * nombre en vez de disfrazarse del primero de la lista.
 *
 * `tipos` es opcional para no obligar a todas las pantallas a bajarse el
 * catálogo: quien lo tiene lo pasa, quien no, pinta con el respaldo.
 */
export function tipoDe(t: string, tipos: TipoAgenda[] = TIPOS): TipoAgenda {
  return tipos.find((x) => x.valor === t) ?? conColor(t, t, "gray")
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
