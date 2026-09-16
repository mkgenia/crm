"use client"

import { cn } from "@/lib/utils"

/**
 * El aviso de "esto no se deshace", como diálogo de la aplicación.
 *
 * POR QUÉ EXISTE ESTO Y NO SE USA `confirm()`.
 * El `confirm()` del navegador LO CANCELAN SOLOS los navegadores incrustados: el
 * panel de vista previa, una webview, un móvil con los diálogos bloqueados.
 * Devuelve `false` sin enseñar nada, el `if (!confirm(...)) return` se lleva por
 * delante la acción, y en pantalla no pasa absolutamente nada: ni aviso, ni
 * error, ni resultado.
 *
 * Así se descubrió: el dueño reportó "el botón de pasar a prospecto no
 * funciona". El botón estaba bien y la función SQL también —se comprobó llamando
 * a la RPC a mano—; lo que fallaba era el aviso. En la base no se había creado ni
 * un solo prospecto de todos sus intentos.
 *
 * Había CINCO sitios con el mismo defecto: pasar a prospecto, dar de baja una
 * captación, borrar una zona del scraper, desactivar una propiedad y borrar una
 * propiedad para siempre. Este componente es para que no haya un sexto.
 *
 * El diseño está copiado de los diálogos de las acciones en masa de
 * `captaciones-list.tsx`, que ya eran de la aplicación y sí funcionaban.
 */
export function Confirmar({
  abierto,
  titulo,
  texto,
  confirmar = "Sí, continuar",
  cancelar = "Cancelar",
  peligro = false,
  ocupado = false,
  onConfirmar,
  onCancelar,
}: {
  abierto: boolean
  titulo: string
  /** Qué va a pasar exactamente. Lo que la gente teme que pase y no pasa, también. */
  texto: string
  confirmar?: string
  cancelar?: string
  /** Rojo para lo que destruye, violeta para lo que sólo avanza. */
  peligro?: boolean
  /** Mientras la acción está en marcha: apaga el botón y lo dice. */
  ocupado?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  if (!abierto) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      // Pinchar fuera cancela, como en cualquier diálogo. No cierra si está
      // ocupado: la acción ya ha salido y cerrar sólo escondería el resultado.
      onClick={() => { if (!ocupado) onCancelar() }}
    >
      <div
        className="bg-card border border-border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-foreground">{titulo}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{texto}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancelar}
            disabled={ocupado}
            className="h-9 px-4 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {cancelar}
          </button>
          <button
            onClick={onConfirmar}
            disabled={ocupado}
            className={cn(
              "h-9 px-4 rounded-md text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
              // Escritas enteras: Tailwind purga las clases armadas con plantilla.
              peligro ? "bg-red-500 hover:bg-red-600" : "bg-violet-500 hover:bg-violet-600",
            )}
          >
            {ocupado ? "Un momento..." : confirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
