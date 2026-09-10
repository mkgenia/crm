import Link from "next/link"
import { ArrowRight } from "lucide-react"

/**
 * Placeholder de las secciones que aún no existen.
 *
 * Se les da entidad en vez de dejar una página en blanco: quien entra tiene que
 * entender qué va a haber aquí y, si mientras tanto hay un sitio donde ya se puede
 * hacer algo parecido, irse allí en un clic. Un "en desarrollo" a secas obliga a
 * volver al menú a probar suerte.
 */
export function EnDesarrollo({
  titulo,
  descripcion,
  mientrasTanto,
}: {
  titulo: string
  descripcion: string
  mientrasTanto?: { texto: string; href: string; enlace: string }
}) {
  return (
    <div className="p-8">
      <div className="max-w-xl">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            En desarrollo
          </span>
        </div>

        <h1 className="text-2xl font-semibold text-foreground">{titulo}</h1>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{descripcion}</p>

        {mientrasTanto && (
          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-foreground">{mientrasTanto.texto}</p>
            <Link
              href={mientrasTanto.href}
              className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium text-violet-500 hover:text-violet-400 transition-colors"
            >
              {mientrasTanto.enlace}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
