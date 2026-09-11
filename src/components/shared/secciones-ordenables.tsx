"use client"

import { Children, isValidElement, useEffect, useState, type ReactElement } from "react"
import { GripVertical, LayoutGrid, Check, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Marca un bloque como reordenable. No pinta nada por sí misma: existe para que
 * el padre pueda leer su `id` y su `titulo` sin que haya que sacar el JSX de
 * cada sección a un array y volver a montarlo.
 */
export function SeccionOrdenable({ children }: {
  id: string
  titulo: string
  children: React.ReactNode
}) {
  return <>{children}</>
}

interface Seccion {
  id: string
  titulo: string
  contenido: React.ReactNode
}

/**
 * Deja al usuario poner las secciones de la portada en el orden que quiera.
 *
 * El orden vive en localStorage y no en la base de datos: es una preferencia de
 * pantalla, distinta en el portátil y en el móvil de la misma persona, y no
 * merece un viaje al servidor cada vez que se arrastra algo.
 *
 * Arrastrar sólo se puede en modo ordenar. Si las secciones fueran arrastrables
 * siempre, cualquier intento de seleccionar un texto acabaría moviendo media
 * portada de sitio.
 */
export function SeccionesOrdenables({
  children,
  claveGuardado,
  encabezado,
  acciones,
}: {
  children: React.ReactNode
  claveGuardado: string
  encabezado?: React.ReactNode
  acciones?: React.ReactNode
}) {
  const secciones: Seccion[] = Children.toArray(children)
    .filter(isValidElement)
    .map((el) => {
      const p = (el as ReactElement<{ id: string; titulo: string }>).props
      return { id: p.id, titulo: p.titulo, contenido: el }
    })
    .filter((s) => s.id)

  const [orden, setOrden] = useState<string[]>(() => secciones.map((s) => s.id))
  const idsDeFabrica = secciones.map((x) => x.id).join()
  const [ordenando, setOrdenando] = useState(false)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [encima, setEncima] = useState<string | null>(null)

  // Se lee en un efecto: localStorage no existe en el servidor y devolver un
  // orden distinto al del HTML rompería la hidratación.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(claveGuardado)
      if (!guardado) return
      const ids = JSON.parse(guardado) as string[]
      // Se filtra contra las secciones que existen hoy: si mañana se añade una
      // nueva o se quita otra, el orden guardado no puede hacerla desaparecer.
      const validas = ids.filter((id) => secciones.some((s) => s.id === id))
      const nuevas = secciones.map((s) => s.id).filter((id) => !validas.includes(id))
      setOrden([...validas, ...nuevas])
    } catch {
      /* modo incógnito o dato corrupto: se queda el orden de fábrica */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveGuardado, idsDeFabrica])

  function guardar(nuevo: string[]) {
    setOrden(nuevo)
    try { localStorage.setItem(claveGuardado, JSON.stringify(nuevo)) } catch { /* idem */ }
  }

  function soltarEn(destino: string) {
    if (!arrastrando || arrastrando === destino) return
    const sinEl = orden.filter((id) => id !== arrastrando)
    const i = sinEl.indexOf(destino)
    sinEl.splice(i, 0, arrastrando)
    guardar(sinEl)
    setArrastrando(null)
    setEncima(null)
  }

  function restablecer() {
    guardar(secciones.map((s) => s.id))
  }

  const porId = new Map(secciones.map((s) => [s.id, s]))
  const ordenadas = orden.map((id) => porId.get(id)).filter(Boolean) as Seccion[]
  const deFabrica = orden.join() === secciones.map((s) => s.id).join()

  return (
    <>
      {/* Ordenar es un control de la pagina entera, no de la primera seccion, asi
          que vive en la fila del encabezado. Cuando flotaba suelto encima de las
          tarjetas caia justo sobre el selector de periodo: dos pastillas
          alineadas a la derecha a un palmo una de otra, que se leian como un
          mismo grupo sin serlo. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">{encabezado}</div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {ordenando && !deFabrica && (
              <button
                onClick={restablecer}
                className="h-8 px-2.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Orden original
              </button>
            )}
            <button
              onClick={() => setOrdenando((v) => !v)}
              className={cn(
                "h-8 px-2.5 rounded-md border text-xs transition-all flex items-center gap-1.5",
                ordenando
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              {ordenando ? <Check className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
              {ordenando ? "Listo" : "Ordenar"}
            </button>
          </div>
          {acciones}
        </div>
      </div>

      {ordenadas.map((s) => (
        <div
          key={s.id}
          draggable={ordenando}
          onDragStart={() => setArrastrando(s.id)}
          onDragEnd={() => { setArrastrando(null); setEncima(null) }}
          onDragOver={(e) => { if (ordenando) { e.preventDefault(); setEncima(s.id) } }}
          onDragLeave={() => setEncima((x) => (x === s.id ? null : x))}
          onDrop={(e) => { e.preventDefault(); soltarEn(s.id) }}
          className={cn(
            "relative transition-all",
            ordenando && "rounded-xl ring-1 ring-dashed ring-border p-2 -m-2",
            arrastrando === s.id && "opacity-40",
            // El hueco marcado: se ve dónde va a caer antes de soltar.
            encima === s.id && arrastrando !== s.id && "ring-2 ring-violet-500/50 ring-solid",
          )}
        >
          {ordenando && (
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground cursor-grab active:cursor-grabbing select-none">
              <GripVertical className="h-3.5 w-3.5" />
              {s.titulo}
            </div>
          )}
          {s.contenido}
        </div>
      ))}
    </>
  )
}
