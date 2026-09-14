"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Tag, X } from "lucide-react"
import { toast } from "sonner"

import { marcarEtiqueta } from "@/lib/actions/catalogos"
import { claseColor, clasePunto, opcionesDe, type Catalogo } from "@/lib/catalogos"
import { cn } from "@/lib/utils"

/**
 * Las etiquetas de un lead.
 *
 * Se pinta antes de que el servidor conteste, pero se deshace si la acción
 * falla: una etiqueta que parece puesta y no lo está es peor que una que tarda
 * medio segundo, porque nadie vuelve a comprobar si se guardó.
 */
export function EtiquetasLead({
  leadId,
  puestas,
  catalogos,
}: {
  leadId: string
  puestas: string[]
  catalogos: Catalogo[]
}) {
  const router = useRouter()

  const [ids, setIds] = useState<string[]>(puestas)
  const [enVuelo, setEnVuelo] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)
  const [indice, setIndice] = useState(0)

  const cajaRef = useRef<HTMLDivElement>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const opcionesRef = useRef<Array<HTMLButtonElement | null>>([])

  // Ordenada porque el orden en que las devuelva el servidor no es un cambio.
  const clavePuestas = useMemo(() => [...puestas].sort().join("|"), [puestas])
  const [claveVista, setClaveVista] = useState(clavePuestas)

  // Cuando el refresh trae la lista del servidor manda ella: lo optimista sólo
  // vale hasta que llega la verdad. Mientras haya algo en vuelo no se toca, o
  // una respuesta que todavía no incluye el cambio borraría la pastilla recién
  // puesta y parecería que la acción ha fallado.
  if (enVuelo.length === 0 && clavePuestas !== claveVista) {
    setClaveVista(clavePuestas)
    setIds(puestas)
  }

  const delTipo = useMemo(() => catalogos.filter((c) => c.tipo === "etiqueta"), [catalogos])
  const activas = useMemo(() => opcionesDe(catalogos, "etiqueta"), [catalogos])

  // Se recorre el catálogo y no `ids` para respetar el orden de la lista y para
  // que una etiqueta archivada que ya estaba puesta se siga viendo: si no, el
  // lead perdería de vista una marca que sigue escrita en la base de datos.
  const pastillas = useMemo(() => delTipo.filter((c) => ids.includes(c.id)), [delTipo, ids])
  const disponibles = useMemo(() => activas.filter((c) => !ids.includes(c.id)), [activas, ids])

  // El índice se acota al pintar y no corrigiéndolo después: al poner una
  // etiqueta la lista encoge, y un índice guardado se queda fuera de rango.
  const activo = disponibles.length === 0 ? -1 : Math.min(indice, disponibles.length - 1)

  // El foco sigue a la opción activa: sin esto el desplegable se abre pero el
  // teclado se queda en el botón y la lista no hay manera de recorrerla.
  useEffect(() => {
    if (!abierto) return
    if (activo < 0) {
      botonRef.current?.focus()
      return
    }
    opcionesRef.current[activo]?.focus()
  }, [abierto, activo, disponibles])

  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener("mousedown", fuera)
    return () => document.removeEventListener("mousedown", fuera)
  }, [abierto])

  function cerrar() {
    setAbierto(false)
    botonRef.current?.focus()
  }

  async function alternar(etiqueta: Catalogo, poner: boolean) {
    setIds((xs) =>
      poner
        ? xs.includes(etiqueta.id)
          ? xs
          : [...xs, etiqueta.id]
        : xs.filter((x) => x !== etiqueta.id)
    )
    setEnVuelo((xs) => [...xs, etiqueta.id])

    let fallo: string | undefined
    try {
      fallo = (await marcarEtiqueta(leadId, etiqueta.id, poner)).error
    } catch {
      fallo = "No se pudo guardar la etiqueta"
    }

    setEnVuelo((xs) => {
      const i = xs.indexOf(etiqueta.id)
      return i === -1 ? xs : [...xs.slice(0, i), ...xs.slice(i + 1)]
    })

    if (fallo) {
      // Se deshace este cambio concreto en vez de restaurar la lista entera:
      // con dos etiquetas en vuelo, restaurarla se llevaría por delante la otra.
      setIds((xs) =>
        poner
          ? xs.filter((x) => x !== etiqueta.id)
          : xs.includes(etiqueta.id)
            ? xs
            : [...xs, etiqueta.id]
      )
      toast.error(fallo)
      return
    }

    router.refresh()
  }

  function teclasMenu(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault()
      cerrar()
      return
    }
    // Tabular sale del desplegable: se cierra, pero sin robarle el foco al
    // elemento al que acaba de saltar.
    if (e.key === "Tab") {
      setAbierto(false)
      return
    }
    const n = disponibles.length
    if (n === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndice((activo + 1) % n)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndice((activo - 1 + n) % n)
    } else if (e.key === "Home") {
      e.preventDefault()
      setIndice(0)
    } else if (e.key === "End") {
      e.preventDefault()
      setIndice(n - 1)
    }
  }

  if (activas.length === 0 && pastillas.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Tag className="h-3.5 w-3.5 shrink-0" />
        <span>
          Todavía no hay etiquetas.{" "}
          <Link
            href="/configuracion/catalogos"
            className="font-medium text-violet-500 underline-offset-2 hover:underline"
          >
            Crear la primera
          </Link>
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pastillas.map((c) => (
        <span
          key={c.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            "animate-in fade-in-0 zoom-in-95 duration-150",
            claseColor(c.color),
            enVuelo.includes(c.id) && "opacity-60"
          )}
        >
          {c.nombre}
          <button
            type="button"
            onClick={() => alternar(c, false)}
            aria-label={`Quitar ${c.nombre}`}
            className="rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-current focus-visible:outline-none"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <div ref={cajaRef} className="relative">
        <button
          ref={botonRef}
          type="button"
          onClick={() => {
            setIndice(0)
            setAbierto((v) => !v)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !abierto) {
              e.preventDefault()
              setIndice(0)
              setAbierto(true)
            } else if (e.key === "Escape" && abierto) {
              e.preventDefault()
              setAbierto(false)
            }
          }}
          aria-haspopup="menu"
          aria-expanded={abierto}
          aria-label="Añadir etiqueta"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs font-medium transition-colors",
            "focus-visible:border-violet-500/60 focus-visible:text-foreground focus-visible:outline-none",
            abierto
              ? "border-violet-500/60 text-foreground"
              : "border-border text-muted-foreground hover:border-violet-500/50 hover:text-foreground"
          )}
        >
          <Plus className="h-3 w-3" />
          Etiqueta
        </button>

        {abierto && (
          <div
            role="menu"
            aria-label="Etiquetas disponibles"
            onKeyDown={teclasMenu}
            className="scrollbar-thin animate-in fade-in-0 zoom-in-95 absolute top-[calc(100%+0.25rem)] left-0 z-50 max-h-56 w-56 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg duration-150"
          >
            {disponibles.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Ya están todas puestas.</p>
            ) : (
              // El menú no se cierra al elegir: lo normal es poner dos o tres
              // seguidas, y reabrirlo cada vez es un clic de más.
              disponibles.map((c, i) => (
                <button
                  key={c.id}
                  ref={(nodo) => {
                    opcionesRef.current[i] = nodo
                  }}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIndice(i)
                    alternar(c, true)
                  }}
                  onMouseEnter={() => setIndice(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors outline-none",
                    i === activo ? "bg-muted/70 text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", clasePunto(c.color))} />
                  <span className="truncate">{c.nombre}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
