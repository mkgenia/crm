import type { Catalogo } from "@/lib/catalogos"

/**
 * El estado de una demanda es texto, no una unión cerrada.
 *
 * Hasta aquí eran cuatro literales escritos en este fichero —"Nuevo",
 * "Contactado", "Cualificado", "Descartado"— con su mapa de colores al lado, y
 * eso traía los dos problemas de siempre. El visible: un estado creado desde
 * /configuracion/catalogos no salía por ninguna parte, que es justo lo
 * contrario de para lo que existe la tabla `catalogos`. Y el que no se veía:
 * `ESTADO_DEMANDA_CFG[d.estado].badge` con un estado que no estuviera en el
 * mapa es `undefined.badge`, o sea la pantalla entera en blanco. Bastaba con
 * que un workflow escribiera otra cosa en `demandas.estado` para tirarla.
 *
 * Ahora la lista sale del catálogo `estado_demanda` y un valor desconocido se
 * sigue pintando: cae a su propio texto y a gris.
 */
export type EstadoDemanda = string

/**
 * Los cuatro de siempre, para cuando el catálogo todavía no los tiene.
 *
 * El catálogo se siembra con una migración, no desde aquí: el día que este
 * código llegue antes que el INSERT, la pantalla tiene que seguir dejando
 * mover una demanda de estado en vez de enseñar una lista vacía. En cuanto las
 * filas existan, mandan ellas: nombres, colores y orden se editan en el panel
 * sin tocar este fichero.
 *
 * Los `id` son de mentira y sólo sirven de key de React; estas filas no se
 * guardan en ningún sitio.
 */
export const ESTADOS_DEMANDA_FALLBACK: Catalogo[] = [
  { id: "fallback-nuevo",       tipo: "estado_demanda", valor: "Nuevo",       nombre: "Nuevo",       color: "violet",  orden: 10, activo: true, sistema: true },
  { id: "fallback-contactado",  tipo: "estado_demanda", valor: "Contactado",  nombre: "Contactado",  color: "cyan",    orden: 20, activo: true, sistema: true },
  { id: "fallback-cualificado", tipo: "estado_demanda", valor: "Cualificado", nombre: "Cualificado", color: "emerald", orden: 30, activo: true, sistema: true },
  { id: "fallback-descartado",  tipo: "estado_demanda", valor: "Descartado",  nombre: "Descartado",  color: "gray",    orden: 40, activo: true, sistema: true },
]

/**
 * El portal del que llega la demanda.
 *
 * Esto NO es el catálogo `fuente` de los leads: allí las fuentes son por dónde
 * entra un contacto al CRM (Instagram, formulario web, captador), y aquí son
 * los portales que mandan el correo con la petición. Se queda como estaba a
 * propósito; moverlo al catálogo es otra tarea y no se toca de paso.
 */
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
