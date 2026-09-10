"use client"

import { useState } from "react"
import { Mail, Smartphone, X, Plus } from "lucide-react"
import { toast } from "sonner"
import { setAvisoEmails, setAvisoTelefonos } from "@/lib/actions/captaciones-config"
import { normalizarEmail, normalizarTelefono, telefonoBonito } from "@/lib/avisos"
import { cn } from "@/lib/utils"

/**
 * Dónde llega el aviso cuando un propietario dice que sí.
 *
 * Se guarda al añadir y al quitar, sin botón de guardar: son dos listas cortas y
 * un "guardar" olvidado significaría no enterarse de un lead. Si la escritura
 * falla, la lista vuelve a como estaba, para que lo que se ve en pantalla sea
 * siempre lo que va a usar el captador.
 */
function Lista({
  titulo,
  descripcion,
  icono: Icono,
  valores,
  onCambio,
  normalizar,
  mostrar,
  placeholder,
  error,
  vacio,
}: {
  titulo: string
  descripcion: string
  icono: typeof Mail
  valores: string[]
  onCambio: (siguiente: string[]) => Promise<{ error?: string } | void>
  normalizar: (v: string) => string | null
  mostrar: (v: string) => string
  placeholder: string
  error: string
  vacio: string
}) {
  const [lista, setLista] = useState(valores)
  const [borrador, setBorrador] = useState("")
  const [guardando, setGuardando] = useState(false)

  async function aplicar(siguiente: string[]) {
    const previa = lista
    setLista(siguiente)
    setGuardando(true)
    const res = await onCambio(siguiente)
    setGuardando(false)
    if (res && "error" in res && res.error) {
      setLista(previa)
      toast.error("No se pudo guardar")
    }
  }

  function anadir() {
    const limpio = normalizar(borrador)
    if (!limpio) return toast.error(error)
    if (lista.includes(limpio)) {
      setBorrador("")
      return toast.error("Ya está en la lista")
    }
    setBorrador("")
    aplicar([...lista, limpio])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icono className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-xs font-medium text-foreground">{titulo}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{descripcion}</p>

      <div className="flex flex-wrap gap-1.5">
        {lista.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2.5 pr-1.5 py-1 text-xs"
          >
            {mostrar(v)}
            <button
              onClick={() => aplicar(lista.filter((x) => x !== v))}
              disabled={guardando}
              aria-label={`Quitar ${mostrar(v)}`}
              className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!lista.length && (
          <span className="text-xs text-amber-500">{vacio}</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir() } }}
          placeholder={placeholder}
          className="flex-1 h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-violet-500/60 transition-colors"
        />
        <button
          onClick={anadir}
          disabled={guardando || !borrador.trim()}
          className={cn(
            "h-8 px-2.5 rounded-md border border-border text-xs flex items-center gap-1 transition-all",
            "hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
          )}
        >
          <Plus className="h-3 w-3" />
          Añadir
        </button>
      </div>
    </div>
  )
}

export function AvisosDestinos({ emails, telefonos }: { emails: string[]; telefonos: string[] }) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Dónde notificar
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Cuando un propietario contesta que sí, o pide que le llamen. No se avisa
          de los demás estados: un aviso que llega por todo se deja de mirar.
        </p>
      </div>

      <Lista
        titulo="Correos"
        descripcion="Llega la ficha completa con la conversación y el botón de llamar."
        icono={Mail}
        valores={emails}
        onCambio={(v) => setAvisoEmails(v)}
        normalizar={normalizarEmail}
        mostrar={(v) => v}
        placeholder="nombre@grupohogares.es"
        error="Ese correo no es válido"
        vacio="Sin correos: no se enviará ninguno."
      />

      <Lista
        titulo="WhatsApp"
        descripcion="El mismo aviso al móvil, con la conversación y el teléfono para llamar de un toque. Sólo móviles españoles."
        icono={Smartphone}
        valores={telefonos}
        onCambio={(v) => setAvisoTelefonos(v)}
        normalizar={normalizarTelefono}
        mostrar={telefonoBonito}
        placeholder="612 345 678"
        error="Eso no es un móvil español"
        vacio="Sin números: no se enviará ningún WhatsApp."
      />
    </section>
  )
}
