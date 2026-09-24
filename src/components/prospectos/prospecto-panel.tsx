"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { AlertCircle, Check, Info, Loader2, Phone, UserCircle, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  actualizarProspecto,
  cambiarEstadoProspecto,
  getProspecto,
} from "@/lib/actions/prospectos"
import { getInteracciones, type Interaccion } from "@/lib/actions/interacciones"
import { crearProspectoEnInmovilla } from "@/lib/actions/inmovilla"
import { Atendido } from "@/components/shared/atendido"
import { LineaTiempo, type PersonaLinea } from "@/components/shared/linea-tiempo"
import { claseColor, clasePunto, nombreDe, opcionesDe, type Catalogo } from "@/lib/catalogos"
import {
  cuando,
  errorDe,
  euros,
  filaDe,
  nombreAgente,
  RELOJ,
  type Prospecto,
} from "./comun"

/**
 * La ficha de un prospecto: lo que hay, lo que se puede corregir y lo que se ha
 * hablado con el propietario.
 *
 * La ficha del prospecto es una COPIA de la captación, congelada en el momento
 * del salto (migración 022), y por eso es editable: el scraper pisa
 * `captaciones` en cada pasada, así que una corrección escrita allí duraría
 * hasta el siguiente barrido. Lo que no hace esta pantalla —y se dice en ella—
 * es tocar el anuncio publicado.
 */

const ESTADO_CAT = "estado_prospecto"
const MOTIVO_CAT = "motivo_perdida"

/** El estado que cierra el trato en pérdida y pide explicación. */
const PERDIDO = "Perdido"

/** Un campo vacío es un dato que no hay, no un cero ni una cadena vacía. */
function aTexto(v: string): string | null {
  return v.trim() || null
}

/**
 * Un precio tecleado, en número.
 *
 * Se limpian los puntos de millar y los espacios porque un comercial escribe
 * "245.000" sin pensarlo, y se acepta la coma decimal. Lo que no sea un número
 * se devuelve como `undefined` para distinguirlo de "he borrado el precio",
 * que sí es `null` y sí se guarda.
 */
function aPrecio(v: string): number | null | undefined {
  const limpio = v.replace(/[\s.€]/g, "").replace(",", ".")
  if (!limpio) return null
  const n = Number(limpio)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function aInput(v: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : ""
}

export function ProspectoPanel({
  prospecto,
  catalogos,
  personas,
  yoId,
  isAdmin,
  onCerrar,
  onActualizado,
}: {
  /** La fila de la lista: se pinta desde el primer fotograma mientras llega la ficha entera. */
  prospecto: Prospecto
  catalogos: Catalogo[]
  personas: PersonaLinea[]
  /** Quién soy. Lo resuelve el servidor, no el navegador. */
  yoId: string
  isAdmin: boolean
  onCerrar: () => void
  /**
   * La ficha ha cambiado. La lista repinta la tarjeta —que no puede quedarse
   * enseñando el precio o el agente viejos— y vuelve a contar las pastillas.
   */
  onActualizado: (p: Prospecto) => void
}) {
  const [ficha, setFicha] = useState<Prospecto>(prospecto)
  const [interacciones, setInteracciones] = useState<Interaccion[]>([])
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState<string | null>(null)

  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [direccion, setDireccion] = useState("")
  const [barrio, setBarrio] = useState("")
  const [precio, setPrecio] = useState("")
  const [precioSalida, setPrecioSalida] = useState("")
  const [notas, setNotas] = useState("")

  /** Estado al que se está moviendo ahora mismo, para apagar las pastillas. */
  const [moviendo, setMoviendo] = useState<string | null>(null)
  /** Cuando el destino es Perdido se pregunta por qué antes de escribirlo. */
  const [preguntandoMotivo, setPreguntandoMotivo] = useState(false)
  const [motivo, setMotivo] = useState("")


  /** Reintentar la subida a Inmovilla de una ficha que no llegó a subir. */
  const [subiendo, setSubiendo] = useState(false)

  /**
   * Subir esta ficha a Inmovilla.
   *
   * Normalmente sube sola al promocionar la captación; esto es para cuando eso
   * falló —su API caída, un dato que no reconoce— y hay que volver a intentarlo.
   * La acción es idempotente: si ya tiene referencia, no crea una segunda.
   */
  async function subirAInmovilla() {
    setSubiendo(true)
    const res: Awaited<ReturnType<typeof crearProspectoEnInmovilla>> =
      await crearProspectoEnInmovilla(ficha.id)
        .catch(() => ({ error: "No se ha podido hablar con Inmovilla" }))
    setSubiendo(false)
    if (res.error) { toast.error(res.error); recargarFicha(); return }
    toast.success(res.yaEstaba ? `Ya estaba como ${res.ref}` : `Subido como ${res.ref}`)
    recargarFicha()
  }

  // null hasta que el componente está hidratado; ver RELOJ.
  const ahora = useSyncExternalStore<number | null>(
    RELOJ.subscribe,
    RELOJ.ahora,
    RELOJ.enServidor,
  )

  // Cada ficha se monta de cero —la lista la remonta con `key`—, así que no hay
  // que limpiar nada al cambiar de prospecto: ni el formulario a medio escribir
  // ni el historial de la anterior sobreviven al salto.
  const id = prospecto.id
  const contactoId = ficha.contacto_id

  /**
   * La ficha entera y su historial.
   *
   * `vivo` corta la respuesta que llega tarde: bajando por la lista se abren dos
   * fichas seguidas, y si la primera contesta después de que se cierre la suya
   * pintaría sus datos sobre una ficha que ya no está en pantalla.
   */
  useEffect(() => {
    let vivo = true

    ;(async () => {
      const [resFicha, resLinea] = await Promise.all([
        getProspecto(id).catch(() => ({ error: "No se ha podido leer el prospecto" })),
        // La historia se pide por el LEAD y no por el prospecto: el propietario
        // es el mismo antes y después de promocionarlo, y una ficha que empieza
        // en blanco borra de la vista todo lo que ya se habló por el captador.
        contactoId
          ? getInteracciones({ leadId: contactoId }).catch(() => ({
              interacciones: [] as Interaccion[],
              error: "No se ha podido leer el historial",
            }))
          : Promise.resolve({ interacciones: [] as Interaccion[], error: undefined }),
      ])
      if (!vivo) return

      const problema = errorDe(resFicha)
      const fila = filaDe(resFicha)
      if (problema || !fila) {
        // Se deja en pantalla lo que ya traía la lista: es de ESTE prospecto y
        // sigue sirviendo para llamar. Lo que no se puede es callarse el fallo.
        setFallo(problema ?? "Este prospecto ya no existe")
      } else {
        setFallo(null)
        setFicha(fila)
      }

      // Un historial vacío por un fallo de lectura se ve igual que un
      // propietario con el que no se ha hablado nunca, y eso se cree.
      if (resLinea.error) toast.error(resLinea.error)
      setInteracciones(resLinea.interacciones ?? [])
      setCargando(false)
    })()

    return () => { vivo = false }
  }, [id, contactoId])

  /**
   * Volver a leer ficha e historial sin desmontar nada.
   *
   * Hace falta porque atender y apuntar escriben en el servidor y esta pantalla
   * no se recarga sola: sin esto, el sello de "atendido" y la nota recién
   * escrita no aparecen hasta cambiar de ficha y volver.
   */
  function recargarFicha() {
    void (async () => {
      const [resFicha, resLinea] = await Promise.all([
        getProspecto(id).catch(() => null),
        contactoId ? getInteracciones({ leadId: contactoId }).catch(() => null) : Promise.resolve(null),
      ])
      const fila = filaDe(resFicha)
      if (fila) {
        setFicha(fila)
        onActualizado(fila)
      } else {
        // Callarlo deja la pantalla enseñando lo de antes justo después de que
        // el usuario haya visto un "guardado": lee que no se ha guardado nada y
        // lo vuelve a escribir. Se dice que lo suyo SÍ está.
        toast.error("Guardado, pero no se ha podido releer la ficha. Recarga la página.")
      }

      if (resLinea && !resLinea.error) {
        setInteracciones(resLinea.interacciones)
      } else if (contactoId) {
        // Sin `contactoId` no hay historial que leer y no ha fallado nada: el
        // aviso sólo sale cuando de verdad se ha ido a buscar y no ha vuelto.
        toast.error("Guardado, pero no se ha podido releer el historial")
      }
    })()
  }

  const ESTADOS = useMemo(() => opcionesDe(catalogos, ESTADO_CAT), [catalogos])
  const MOTIVOS = useMemo(() => opcionesDe(catalogos, MOTIVO_CAT), [catalogos])

  /** El sello de la última vez que una persona lo atendió, con nombre. */
  const yaAtendido = useMemo(() => {
    if (!ficha.atendido_en) return null
    const quien = personas.find((p) => p.id === ficha.atendido_por)
    return { en: ficha.atendido_en, por: quien?.nombre ?? null }
  }, [ficha.atendido_en, ficha.atendido_por, personas])

  function abrirEdicion() {
    setDireccion(ficha.direccion ?? "")
    setBarrio(ficha.barrio ?? "")
    setPrecio(aInput(ficha.precio))
    setPrecioSalida(aInput(ficha.precio_salida))
    setNotas(ficha.descripcion ?? "")
    setEditando(true)
  }

  /**
   * Guardar las correcciones de la ficha.
   *
   * El `.catch` no es decorativo: sin él, una acción que ni llega a contestar
   * —red caída, despliegue a mitad— rompe la promesa, deja `guardando` en true
   * y el botón girando para siempre sin decir nada.
   */
  async function guardar() {
    if (guardando) return

    const p = aPrecio(precio)
    const ps = aPrecio(precioSalida)
    if (p === undefined) return toast.error("El precio no es un número")
    if (ps === undefined) return toast.error("El precio de salida no es un número")

    const campos = {
      direccion: aTexto(direccion),
      barrio: aTexto(barrio),
      precio: p,
      precio_salida: ps,
      descripcion: aTexto(notas),
    }

    setGuardando(true)
    const res = await actualizarProspecto(id, campos).catch(() => ({
      error: "No se han podido guardar los cambios",
    }))
    setGuardando(false)

    const problema = errorDe(res)
    // Al fallar, el formulario NO se cierra: lo que se acaba de escribir es
    // justo lo que no se puede perder, y volver a teclearlo es no teclearlo.
    if (problema) return toast.error(problema)

    const actualizado: Prospecto = { ...ficha, ...campos }
    setFicha(actualizado)
    setEditando(false)
    onActualizado(actualizado)
    toast.success("Ficha actualizada")
  }

  /**
   * Mover el prospecto de estado.
   *
   * La escritura se comprueba antes de pintar nada. Pintar el estado nuevo pase
   * lo que pase deja la pantalla diciendo "Captado" con la base de datos
   * diciendo "Nuevo", y de eso nadie se entera hasta que reaparece donde no toca.
   */
  async function moverA(estado: string, conMotivo?: string) {
    if (moviendo || estado === ficha.estado) return
    setMoviendo(estado)

    const res = await cambiarEstadoProspecto(id, estado, conMotivo || undefined).catch(() => ({
      error: "No se ha podido cambiar el estado",
    }))
    setMoviendo(null)

    const problema = errorDe(res)
    if (problema) return toast.error(problema)

    const actualizado: Prospecto = { ...ficha, estado }
    setFicha(actualizado)
    setPreguntandoMotivo(false)
    setMotivo("")
    onActualizado(actualizado)
    toast.success(`Movido a ${nombreDe(catalogos, ESTADO_CAT, estado)}`)
  }

  function pulsarEstado(valor: string) {
    if (valor === ficha.estado) return
    // Perder un piso sin decir por qué es perder también el motivo: sin eso no
    // se sabe si se caen por precio o por no haber llamado a tiempo. El servidor
    // lo exige, así que se pregunta aquí antes de que rebote.
    if (valor === PERDIDO) {
      setPreguntandoMotivo(true)
      return
    }
    void moverA(valor)
  }

  const direccionVisible = ficha.direccion ?? "Sin dirección"
  const zona = [ficha.barrio, ficha.ciudad].filter(Boolean).join(" · ")

  return (
    <div className="w-[23rem] shrink-0 rounded-xl border border-border bg-card flex flex-col overflow-hidden">

      {/* Cabecera */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="min-w-0 flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-foreground truncate" title={direccionVisible}>
            {direccionVisible}
          </h2>
          {zona && <p className="text-xs text-muted-foreground truncate">{zona}</p>}
        </div>
        <button
          onClick={onCerrar}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Cerrar ficha"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 flex flex-col gap-5">

        {fallo && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-xs text-foreground">{fallo}</p>
          </div>
        )}

        {/* Los dos precios, que son dos cosas distintas: lo que pide el
            propietario y lo que se acuerda para salir al mercado. */}
        <div className="grid grid-cols-2 gap-px bg-border rounded-lg overflow-hidden">
          <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Precio propietario</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">{euros(ficha.precio)}</p>
          </div>
          <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Precio de salida</p>
            <p className="text-sm font-semibold text-foreground tabular-nums">{euros(ficha.precio_salida)}</p>
          </div>
        </div>

        {/* Propietario */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Propietario</p>
          <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {ficha.contacto_nombre ?? "Sin nombre"}
            </p>
            {ficha.contacto_telefono ? (
              <a
                href={`tel:${ficha.contacto_telefono}`}
                className="inline-flex items-center gap-1.5 text-sm text-violet-500 hover:text-violet-400 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                {ficha.contacto_telefono}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic">Sin teléfono</p>
            )}
          </div>
        </div>

        {/* Las dos personas. Se enseñan juntas a propósito: media razón de que
            los prospectos sean una tabla aparte es poder decir "lo captó Raúl"
            aunque hoy lo lleve otro. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border p-3 flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Lo captó</p>
            <p className="text-sm text-foreground truncate flex items-center gap-1.5">
              <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{nombreAgente(personas, ficha.captado_por)}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border p-3 flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Lo lleva</p>
            <p className="text-sm text-foreground truncate flex items-center gap-1.5">
              <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{nombreAgente(personas, ficha.agente_id)}</span>
            </p>
          </div>
        </div>

        {/* Embudo */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estado</p>
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS.map(({ valor, nombre, color }) => (
              <button
                key={valor}
                onClick={() => pulsarEstado(valor)}
                disabled={moviendo !== null}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border font-medium transition-all disabled:opacity-40",
                  valor === ficha.estado
                    ? claseColor(color)
                    : "border-border text-muted-foreground hover:border-muted-foreground/40",
                )}
              >
                {moviendo === valor ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className={cn("h-1.5 w-1.5 rounded-full", clasePunto(color))} />
                )}
                {nombre}
              </button>
            ))}
          </div>

          {preguntandoMotivo && (
            <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">¿Por qué se pierde?</p>
              {MOTIVOS.length === 0 ? (
                // Sin motivos en el catálogo no se puede cerrar en pérdida, y el
                // servidor lo rechazaría igualmente: mejor decir dónde se añaden
                // que dejar que el botón falle sin explicar nada.
                <div className="flex flex-col gap-2 items-start">
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">
                    No hay motivos de pérdida configurados. Se añaden en Configuración → Catálogos.
                  </p>
                  <button
                    onClick={() => setPreguntandoMotivo(false)}
                    className="h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  <select
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Elige un motivo</option>
                    {MOTIVOS.map((m) => (
                      <option key={m.valor} value={m.valor}>{m.nombre}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void moverA(PERDIDO, motivo)}
                      disabled={moviendo !== null || !motivo}
                      className="h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {moviendo ? "Guardando..." : "Marcar perdido"}
                    </button>
                    <button
                      onClick={() => { setPreguntandoMotivo(false); setMotivo("") }}
                      className="h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* INMOVILLA. Una línea cuando todo ha ido bien —la referencia con la
            que quedó allí— y un aviso con botón cuando no subió. El prospecto
            existe en el CRM en los dos casos: subir a Inmovilla pasa después de
            la promoción y a propósito, para que su API caída no impida captar. */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Inmovilla</p>
          {ficha.propiedad_ref ? (
            <p className="text-xs text-muted-foreground">
              Subido como <span className="text-foreground font-medium">{ficha.propiedad_ref}</span>
            </p>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex flex-col gap-2">
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
                {ficha.inmovilla_error ?? "Todavía no está en Inmovilla."}
              </p>
              <button
                onClick={() => void subirAInmovilla()}
                disabled={subiendo}
                className="self-start flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-amber-500/20 text-[11px] font-medium text-amber-700 dark:text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
              >
                {subiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {subiendo ? "Subiendo…" : "Subir a Inmovilla"}
              </button>
            </div>
          )}
        </div>

        {/* Ficha editable */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Ficha</p>
            {!editando ? (
              <button
                onClick={abrirEdicion}
                // Hasta que no ha llegado la ficha ENTERA no se puede corregir, y
                // no es una pega de estilo: la lista no trae `descripcion` —no
                // está en COLUMNAS_LISTA—, así que mientras se espera a
                // getProspecto las notas del inmueble valen null. Abriendo el
                // formulario en esa ventana, "Notas" salía vacío y el primer
                // Guardar escribía descripcion = NULL encima de lo que hubiera.
                // Borrar las notas de un piso por haber pulsado medio segundo
                // antes de tiempo no se puede deshacer.
                disabled={cargando || fallo !== null}
                title={
                  cargando
                    ? "Cargando la ficha completa..."
                    : fallo !== null
                      ? "No se ha podido leer la ficha: no se puede corregir a ciegas"
                      : undefined
                }
                className="text-xs font-medium text-violet-500 hover:text-violet-400 transition-colors disabled:opacity-40 disabled:hover:text-violet-500"
              >
                Corregir
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditando(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void guardar()}
                  disabled={guardando}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                >
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar
                </button>
              </div>
            )}
          </div>

          {editando ? (
            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Dirección</span>
                <input
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Calle y número"
                  className="h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Barrio</span>
                <input
                  value={barrio}
                  onChange={(e) => setBarrio(e.target.value)}
                  placeholder="Ruzafa, Benimaclet…"
                  className="h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Precio (€)</span>
                  <input
                    value={precio}
                    onChange={(e) => setPrecio(e.target.value)}
                    inputMode="decimal"
                    placeholder="245000"
                    className="h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground tabular-nums placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Salida (€)</span>
                  <input
                    value={precioSalida}
                    onChange={(e) => setPrecioSalida(e.target.value)}
                    inputMode="decimal"
                    placeholder="239000"
                    className="h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground tabular-nums placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Notas del inmueble</span>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={3}
                  placeholder="Lo que hay que saber del piso: estado, llaves, horarios de visita…"
                  className="px-2.5 py-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </label>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Lo que se habla con el propietario va abajo, en el historial: esto es la ficha del piso.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Dirección</span>
                <span className="text-foreground text-right truncate">{ficha.direccion ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Barrio</span>
                <span className="text-foreground text-right truncate">{ficha.barrio ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Notas</span>
                <span className="text-foreground text-right line-clamp-3">{ficha.descripcion ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Último toque</span>
                <span className="text-foreground text-right">{cuando(ficha.atendido_en, ahora)}</span>
              </div>
            </div>
          )}

          {/* El aviso sigue siendo importante —alguien puede pasarse una tarde
              corrigiendo precios creyendo que arregla el anuncio; la cartera la
              publica Inmovilla desde su XML y el CRM no la escribe—, pero sólo
              sale MIENTRAS SE CORRIGE, que es el único momento en que el
              malentendido puede ocurrir. Estaba fijo, y una advertencia que se
              ve cada vez que se abre una ficha deja de leerse a la tercera. */}
          {editando && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
                Esto se queda en el CRM: el anuncio publicado lo lleva Inmovilla y no viaja al portal.
              </p>
            </div>
          )}
        </div>

        {/* El día del comercial: se atiende arriba y lo apuntado queda debajo. */}
        <Atendido
          // Se atiende POR EL CONTACTO y no por el prospecto porque hoy es lo
          // único que llega hasta la base: `atender()` de
          // lib/actions/interacciones.ts manda `p_prospecto_id: null` fijo y
          // <Atendido/> ni siquiera declara `prospectoId`. La RPC sí lo acepta
          // (migración 030), así que cuando esos dos ficheros lo pasen, aquí se
          // añade `prospectoId={ficha.id}` y con él llegan el sello
          // `prospectos.atendido_en` y el salto a Perdido con "no_interesa".
          // Mientras tanto esto NO es un apaño vacío: el propietario es el mismo
          // lead antes y después de promocionar, la nota y el recordatorio
          // quedan escritos y salen justo debajo, en la línea de tiempo, que
          // también se pide por `contacto_id`. Sin contacto, <Atendido/> se
          // apaga solo en vez de fallar al pulsarlo.
          leadId={ficha.contacto_id ?? undefined}
          catalogos={catalogos}
          yaAtendido={yaAtendido}
          // Atender apunta la nota, puede dejar un recordatorio y mueve el
          // embudo según el chip: hay que releer la ficha entera, no sólo el
          // historial. Al releerla avisa a la lista, que también se actualiza.
          onHecho={() => recargarFicha()}
        />

        {cargando ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Cargando historial...
          </div>
        ) : (
          <LineaTiempo
            interacciones={interacciones}
            catalogos={catalogos}
            personas={personas}
            yoId={yoId}
            isAdmin={isAdmin}
            // Lo que se apunte cuelga del contacto, que es donde vive el resto
            // de su historia: la del captador y la de la conversación anterior.
            leadId={ficha.contacto_id ?? undefined}
            // Esta lista la pide el propio panel, así que el `router.refresh()`
            // de dentro no le recarga nada: cada anotación y cada borrado avisan.
            onCambio={() => recargarFicha()}
          />
        )}
      </div>
    </div>
  )
}
