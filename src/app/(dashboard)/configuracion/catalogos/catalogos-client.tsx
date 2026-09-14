"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, Check, Lock, Pencil, Plus, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { actualizarValor, archivarValor, crearValor } from "@/lib/actions/catalogos"
import { COLORES, TIPOS, claseColor, clasePunto, type Catalogo } from "@/lib/catalogos"

/**
 * Administración de los catálogos.
 *
 * Cada cambio va contra su acción de servidor y después se llama a
 * `router.refresh()` en vez de tocar una copia local de la lista: el recuento de
 * uso lo calcula el servidor y una lista optimista lo dejaría mintiendo.
 */

/**
 * Los que ha metido solo el trigger al ver un valor que no estaba en la lista.
 *
 * No hay columna que lo diga: la marca es la forma en que los deja el trigger
 * —apagados, en gris y al final—, y en cuanto un humano los repasa deja de
 * cumplirse, porque les pone color y los activa.
 */
function esSinRevisar(c: Catalogo): boolean {
  return !c.activo && !c.sistema && c.orden === 900 && (c.color ?? "gray") === "gray"
}

/**
 * `getUsoCatalogos` sólo sabe contar las listas que están escritas en filas:
 * estado y fuente del lead, estado de WhatsApp de la captación y etiquetas.
 *
 * De las demás no cuenta nada, y poner ahí un "0 filas" se leería como "no lo
 * usa nadie, archívalo" cuando lo cierto es "no lo sabemos".
 */
const CON_RECUENTO = new Set(["estado_lead", "fuente", "estado_whatsapp", "etiqueta"])

/** Las listas que esta pantalla pinta. La tabla admite `tipo` libre. */
const TIPOS_VISIBLES = new Set<string>(TIPOS.map((t) => t.tipo))

function usoDe(uso: Record<string, number>, c: Catalogo): number | null {
  if (!CON_RECUENTO.has(c.tipo)) return null
  // Las etiquetas se cuentan por id porque `lead_etiquetas` guarda la clave
  // ajena; las demás listas se guardan en la fila por su `valor`.
  return uso[c.tipo === "etiqueta" ? `id:${c.id}` : `${c.tipo}:${c.valor}`] ?? 0
}

function textoUso(n: number | null): string {
  if (n === null) return "—"
  if (n === 0) return "sin uso"
  return n === 1 ? "1 fila" : `${n} filas`
}

const CLASE_INPUT =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-violet-500/60"

const CLASE_ICONO =
  "h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"

/** Los diez colores de COLORES. La clase sale de clasePunto, nunca de una plantilla. */
function Paleta({
  valor,
  onElegir,
  disabled,
}: {
  valor: string
  onElegir: (color: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORES.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onElegir(c)}
          aria-label={`Color ${c}`}
          aria-pressed={valor === c}
          className={cn(
            "h-5 w-5 rounded-full transition-transform hover:scale-110 disabled:opacity-40",
            clasePunto(c),
            valor === c && "ring-2 ring-offset-2 ring-offset-card ring-foreground/70"
          )}
        />
      ))}
    </div>
  )
}

/** Cómo va a quedar el valor en el resto del CRM, mientras se escribe. */
function Muestra({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        claseColor(color)
      )}
    >
      {nombre.trim() || "Sin nombre"}
    </span>
  )
}

export function CatalogosClient({
  catalogos,
  uso,
  error,
}: {
  catalogos: Catalogo[]
  uso: Record<string, number>
  error?: string
}) {
  const router = useRouter()
  const [ocupado, startTransition] = useTransition()

  const [editando, setEditando] = useState<string | null>(null)
  const [nombreEd, setNombreEd] = useState("")
  const [colorEd, setColorEd] = useState("gray")

  const [creandoEn, setCreandoEn] = useState<string | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState("")
  const [colorNuevo, setColorNuevo] = useState("violet")

  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [soloSinRevisar, setSoloSinRevisar] = useState(false)

  // Se descartan los de un tipo que no está en TIPOS: la tabla admite `tipo`
  // libre, y contarlos en el aviso prometería un valor que el filtro no tiene
  // dónde enseñar.
  const sinRevisar = useMemo(
    () => catalogos.filter((c) => TIPOS_VISIBLES.has(c.tipo) && esSinRevisar(c)),
    [catalogos]
  )

  // El filtro se apaga solo en cuanto no queda nada sin revisar: el botón para
  // quitarlo vive dentro del aviso, así que al repasar el último valor el aviso
  // desaparecería con él y la pantalla se quedaría en blanco sin salida.
  const filtrando = soloSinRevisar && sinRevisar.length > 0

  // Sin lectura no llega ni un valor. Pintar las ocho listas vacías invitando a
  // "añadir el primer valor" mandaría a duplicar lo que sí está en la base.
  const lecturaRota = Boolean(error) && catalogos.length === 0
  const listas = lecturaRota ? ([] as typeof TIPOS) : TIPOS

  const porTipo = useMemo(() => {
    const m: Record<string, Catalogo[]> = {}
    for (const c of catalogos) (m[c.tipo] ??= []).push(c)
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
    }
    return m
  }, [catalogos])

  function cerrarTodo() {
    setEditando(null)
    setCreandoEn(null)
    setConfirmando(null)
  }

  function abrirEdicion(c: Catalogo) {
    cerrarTodo()
    setEditando(c.id)
    setNombreEd(c.nombre)
    setColorEd(c.color ?? "gray")
  }

  function guardarEdicion(c: Catalogo) {
    if (ocupado) return
    const nombre = nombreEd.trim()
    if (nombre.length < 2) {
      toast.error("El nombre es demasiado corto")
      return
    }

    startTransition(async () => {
      const r = await actualizarValor(c.id, { nombre, color: colorEd })
      if (r.error) {
        toast.error(r.error)
        return
      }
      setEditando(null)
      toast.success("Guardado")
      router.refresh()
    })
  }

  function abrirAlta(tipo: string) {
    cerrarTodo()
    setCreandoEn(tipo)
    setNombreNuevo("")
    setColorNuevo("violet")
  }

  function crear(tipo: string) {
    if (ocupado) return
    const nombre = nombreNuevo.trim()
    if (nombre.length < 2) {
      toast.error("El nombre es demasiado corto")
      return
    }

    startTransition(async () => {
      const r = await crearValor({ tipo, nombre, color: colorNuevo })
      if (r.error) {
        toast.error(r.error)
        return
      }
      // El formulario se queda abierto y vacío: quien añade una zona casi
      // siempre añade tres seguidas.
      setNombreNuevo("")
      toast.success(`"${nombre}" añadido`)
      router.refresh()
    })
  }

  function archivar(c: Catalogo, activo: boolean) {
    startTransition(async () => {
      const r = await archivarValor(c.id, activo)
      if (r.error) {
        toast.error(r.error)
        return
      }
      setConfirmando(null)
      toast.success(activo ? `"${c.nombre}" activado` : `"${c.nombre}" archivado`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-7xl">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Catálogos</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Las listas que alimentan los desplegables del CRM. El nombre y el color se cambian cuando
          haga falta; la clave técnica que guardan las filas y leen los workflows de n8n no se toca
          nunca.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] px-5 py-4">
          <TriangleAlert className="h-4 w-4 shrink-0 text-rose-500" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">No se han podido leer los catálogos</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {sinRevisar.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-5 py-4">
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <p className="text-sm font-semibold">
              {sinRevisar.length === 1
                ? "1 valor nuevo sin revisar"
                : `${sinRevisar.length} valores nuevos sin revisar`}
            </p>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Los ha creado un workflow al guardar algo que no estaba en la lista. Entran apagados y
              en gris para que no se cuelen en los desplegables sin que nadie los mire: ponles
              nombre y color y actívalos, o déjalos archivados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSoloSinRevisar((v) => !v)}
            className="h-8 shrink-0 rounded-md border border-amber-500/40 px-3 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
          >
            {filtrando ? "Ver todos" : "Ver sólo estos"}
          </button>
        </div>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {listas.map((t) => {
          const todos = porTipo[t.tipo] ?? []
          const lista = filtrando ? todos.filter(esSinRevisar) : todos
          if (filtrando && lista.length === 0) return null

          const activos = todos.filter((c) => c.activo).length
          const archivados = todos.length - activos

          return (
            <section key={t.tipo} className="flex flex-col rounded-xl border border-border bg-card">
              <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{t.titulo}</h2>
                    {t.bloqueado && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        title="El CRM y los workflows leen esta lista por su clave técnica"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        Lista en uso
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.descripcion}</p>
                </div>

                <button
                  type="button"
                  onClick={() => abrirAlta(t.tipo)}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-violet-500/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Añadir
                </button>
              </header>

              {lista.length === 0 ? (
                <p className="px-5 py-6 text-xs text-muted-foreground">
                  Esta lista está vacía. Añade el primer valor.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {lista.map((c) => {
                    const nuevo = esSinRevisar(c)
                    const n = usoDe(uso, c)

                    if (editando === c.id) {
                      return (
                        <li key={c.id} className="flex flex-col gap-3 bg-muted/30 px-5 py-4">
                          <input
                            autoFocus
                            value={nombreEd}
                            onChange={(e) => setNombreEd(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") guardarEdicion(c)
                              if (e.key === "Escape") setEditando(null)
                            }}
                            className={CLASE_INPUT}
                            aria-label="Nombre del valor"
                          />
                          <Paleta valor={colorEd} onElegir={setColorEd} disabled={ocupado} />
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <Muestra nombre={nombreEd} color={colorEd} />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditando(null)}
                                className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => guardarEdicion(c)}
                                className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500 px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Guardar
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            La clave técnica sigue siendo{" "}
                            <span className="font-mono">{c.valor}</span>: renombrar no migra nada.
                          </p>
                        </li>
                      )
                    }

                    return (
                      <li
                        key={c.id}
                        className={cn(
                          "flex flex-col gap-2 px-5 py-3",
                          nuevo && "bg-amber-500/[0.06]"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", clasePunto(c.color))}
                            aria-hidden="true"
                          />

                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "text-sm",
                                  !c.activo &&
                                    "text-muted-foreground line-through decoration-muted-foreground/40"
                                )}
                              >
                                {c.nombre}
                              </span>
                              {nuevo && (
                                <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                                  Sin revisar
                                </span>
                              )}
                              {!c.activo && !nuevo && (
                                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Archivado
                                </span>
                              )}
                            </div>
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {c.valor}
                            </span>
                          </div>

                          <span
                            className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            title={
                              n === null
                                ? "De esta lista no se cuenta el uso en ninguna tabla"
                                : "Filas que guardan este valor ahora mismo"
                            }
                          >
                            {textoUso(n)}
                          </span>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => abrirEdicion(c)}
                              className={CLASE_ICONO}
                              aria-label={`Editar ${c.nombre}`}
                              title="Renombrar y cambiar el color"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>

                            {c.sistema && c.activo ? (
                              // El candado no se pinta desactivado: pulsarlo explica por qué no
                              // se archiva, que es lo que necesita leer quien lo intenta.
                              <button
                                type="button"
                                onClick={() =>
                                  toast.error(
                                    `"${c.nombre}" lo escriben los workflows de n8n. Archivarlo rompería lo que está corriendo ahora mismo.`
                                  )
                                }
                                className={cn(CLASE_ICONO, "hover:text-amber-500")}
                                aria-label={`${c.nombre} no se puede archivar`}
                                title="Valor de sistema: lo escriben los workflows de n8n"
                              >
                                <Lock className="h-3.5 w-3.5" />
                              </button>
                            ) : c.activo ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditando(null)
                                  setConfirmando(c.id)
                                }}
                                className={cn(CLASE_ICONO, "hover:text-rose-500")}
                                aria-label={`Archivar ${c.nombre}`}
                                title="Archivar"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => archivar(c, true)}
                                className={cn(CLASE_ICONO, "hover:text-emerald-500")}
                                aria-label={`Activar ${c.nombre}`}
                                title="Volver a ofrecerlo en los desplegables"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {confirmando === c.id && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                            <p className="min-w-56 flex-1 text-xs text-muted-foreground">
                              {n === null
                                ? "Dejará de ofrecerse en los desplegables. De esta lista no se cuenta el uso, así que compruébalo antes."
                                : n === 0
                                  ? "No lo usa ninguna fila. Dejará de ofrecerse en los desplegables."
                                  : `Lo usan ${n} ${n === 1 ? "fila" : "filas"}. Dejará de ofrecerse en los desplegables, pero esas filas lo seguirán enseñando.`}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirmando(null)}
                                className={cn(CLASE_ICONO, "border border-border")}
                                aria-label="Cancelar"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => archivar(c, false)}
                                className="h-8 rounded-md bg-rose-500 px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                Archivar
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {creandoEn === t.tipo && (
                <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-5 py-4">
                  <input
                    autoFocus
                    value={nombreNuevo}
                    onChange={(e) => setNombreNuevo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") crear(t.tipo)
                      if (e.key === "Escape") setCreandoEn(null)
                    }}
                    placeholder="Nombre del valor nuevo"
                    className={CLASE_INPUT}
                    aria-label={`Nombre del valor nuevo en ${t.titulo}`}
                  />
                  <Paleta valor={colorNuevo} onElegir={setColorNuevo} disabled={ocupado} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Muestra nombre={nombreNuevo} color={colorNuevo} />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCreandoEn(null)}
                        className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cerrar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => crear(t.tipo)}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500 px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Añadir
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    La clave técnica la calcula el servidor a partir del nombre y ya no cambia.
                  </p>
                </div>
              )}

              <footer className="border-t border-border px-5 py-2.5 text-[11px] text-muted-foreground">
                {activos} {activos === 1 ? "activo" : "activos"}
                {archivados > 0 && ` · ${archivados} archivado${archivados === 1 ? "" : "s"}`}
              </footer>
            </section>
          )
        })}
      </div>
    </div>
  )
}
