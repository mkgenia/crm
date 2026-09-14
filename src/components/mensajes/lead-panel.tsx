"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { UserPlus, Pencil, Check, X, Loader2, ExternalLink, History } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { actualizarNotasLead, crearLeadDesdeChat } from "@/lib/actions/leads"
import { cambiarEstadoLead, getInteracciones, type Interaccion } from "@/lib/actions/interacciones"
import { getCatalogosActivos } from "@/lib/actions/catalogos"
import { getAgentes } from "@/lib/actions/captaciones"
import { nombreDe, opcionesDe, type Catalogo } from "@/lib/catalogos"
import { EtiquetasLead } from "@/components/leads/etiquetas-lead"
import { LineaTiempo, type PersonaLinea } from "@/components/shared/linea-tiempo"
import type { EstadoLead } from "@/types/captaciones"

const ESTADOS: EstadoLead[] = ["Nuevo", "Contactado", "Interesado", "Propuesta", "Negociacion", "Ganado", "Perdido"]

const ESTADO_CFG: Record<EstadoLead, { badge: string; label: string }> = {
  Nuevo:       { badge: "bg-violet-500/10 text-violet-500 border-violet-500/20",    label: "Nuevo" },
  Contactado:  { badge: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",          label: "Contactado" },
  Interesado:  { badge: "bg-blue-500/10 text-blue-500 border-blue-500/20",          label: "Interesado" },
  Propuesta:   { badge: "bg-orange-500/10 text-orange-500 border-orange-500/20",    label: "Propuesta" },
  Negociacion: { badge: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",    label: "Negociación" },
  Ganado:      { badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", label: "Ganado" },
  Perdido:     { badge: "bg-muted text-muted-foreground border-border",             label: "Perdido" },
}

interface Lead {
  id: string
  nombre: string
  apellidos: string | null
  telefono: string | null
  email: string | null
  estado: EstadoLead
  notas: string | null
  fuente: string | null
  fecha_creacion: string
  captacion_id: number | null
}

interface Props {
  lead: Lead | null
  chatName: string | null
  phone: string
  onLeadCreated: (lead: Lead) => void
}

/** Lo que se pide por lead: su historial, sus etiquetas y por qué se perdió. */
interface Ficha {
  interacciones: Interaccion[]
  etiquetas: string[]
  motivo: string | null
}

const FICHA_VACIA: Ficha = { interacciones: [], etiquetas: [], motivo: null }

export function LeadPanel({ lead: initialLead, chatName, phone, onLeadCreated }: Props) {
  const [lead, setLead] = useState<Lead | null>(initialLead)
  const [editandoNotas, setEditandoNotas] = useState(false)
  const [notas, setNotas] = useState(initialLead?.notas ?? "")
  const [savingNotas, setSavingNotas] = useState(false)
  const [creando, startCreando] = useTransition()
  const [updatingEstado, setUpdatingEstado] = useState(false)

  const [catalogos, setCatalogos] = useState<Catalogo[]>([])
  // Sin esto no se distingue "todavía no han llegado" de "no hay ninguna", y la
  // ficha invitaba a crear la primera etiqueta con las etiquetas cargando.
  const [catalogosListos, setCatalogosListos] = useState(false)
  const [personas, setPersonas] = useState<PersonaLinea[]>([])
  const [yo, setYo] = useState<{ id: string; isAdmin: boolean }>({ id: "", isAdmin: false })
  const [ficha, setFicha] = useState<Ficha>(FICHA_VACIA)
  const [verHistorial, setVerHistorial] = useState(false)
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false)
  const [motivo, setMotivo] = useState("")

  const leadId = initialLead?.id ?? null

  // El panel no se desmonta al cambiar de conversación —ChatView es el mismo—,
  // así que sin esto seguiría enseñando el lead del chat anterior.
  const [leadVisto, setLeadVisto] = useState(leadId)
  if (leadId !== leadVisto) {
    setLeadVisto(leadId)
    setLead(initialLead)
    setNotas(initialLead?.notas ?? "")
    setEditandoNotas(false)
    setPidiendoMotivo(false)
    setVerHistorial(false)
    setFicha(FICHA_VACIA)
  }

  const motivosPerdida = useMemo(() => opcionesDe(catalogos, "motivo_perdida"), [catalogos])

  // El motivo que se guarda es el mismo que se está viendo. Si el guardado está
  // archivado —o si los catálogos llegaron después de abrir el recuadro—, el
  // desplegable enseñaba el primero y el estado seguía valiendo otra cosa: o se
  // guardaba un motivo distinto del elegido, o el botón se quedaba apagado sin
  // explicar por qué.
  const motivoElegido = motivosPerdida.some((m) => m.valor === motivo)
    ? motivo
    : motivosPerdida[0]?.valor ?? ""

  // Los catálogos y el equipo no dependen de la conversación: se piden una vez.
  useEffect(() => {
    let vivo = true
    const supabase = createClient()

    ;(async () => {
      try {
        const [cats, agentes] = await Promise.all([getCatalogosActivos(), getAgentes()])
        if (!vivo) return
        setCatalogos(cats)
        setPersonas(
          (agentes as Array<{ id: string; nombre: string | null; apellidos: string | null }>).map((a) => ({
            id: a.id,
            nombre: `${a.nombre ?? ""} ${a.apellidos ?? ""}`.trim() || "—",
          }))
        )
      } catch {
        if (vivo) toast.error("No se pudieron cargar los catálogos")
      } finally {
        // Se marca listo aunque falle: con las listas vacías la interfaz enseña
        // "todavía no hay ninguna", y eso al menos se puede leer y arreglar.
        if (vivo) setCatalogosListos(true)
      }

      // Quién soy sale de la sesión del navegador porque este panel cuelga de un
      // árbol de cliente: la línea de tiempo lo necesita para saber qué
      // anotaciones puedo borrar.
      const { data: { user } } = await supabase.auth.getUser()
      if (!vivo || !user) return
      const { data: perfil } = await supabase
        .from("perfiles").select("rol").eq("id", user.id).maybeSingle()
      if (!vivo) return
      setYo({ id: user.id, isAdmin: (perfil as { rol: string } | null)?.rol === "Admin" })
    })().catch(() => {})

    return () => { vivo = false }
  }, [])

  // Se rompe a propósito si algo falla en vez de devolver una ficha vacía: sin
  // esto, un error de lectura se veía igual que un lead sin etiquetas y sin
  // historial, y quien mira la ficha se lo creía.
  const leerFicha = useCallback(async (id: string): Promise<Ficha> => {
    const supabase = createClient()
    const [hist, etq, fila] = await Promise.all([
      getInteracciones({ leadId: id }),
      supabase.from("lead_etiquetas").select("etiqueta_id").eq("lead_id", id),
      supabase.from("leads").select("motivo_perdida").eq("id", id).maybeSingle(),
    ])
    const fallo = hist.error ?? etq.error?.message ?? fila.error?.message
    if (fallo) throw new Error(fallo)
    return {
      interacciones: hist.interacciones,
      etiquetas: ((etq.data ?? []) as Array<{ etiqueta_id: string }>).map((r) => r.etiqueta_id),
      motivo: (fila.data as { motivo_perdida: string | null } | null)?.motivo_perdida ?? null,
    }
  }, [])

  useEffect(() => {
    if (!leadId) return
    let vivo = true
    leerFicha(leadId)
      .then((f) => { if (vivo) setFicha(f) })
      .catch(() => { if (vivo) toast.error("No se pudo leer la ficha del lead") })
    return () => { vivo = false }
  }, [leadId, leerFicha])

  // Mientras el historial está abierto se vuelve a pedir cada poco, que es
  // cuando se escribe —y de paso entra lo que apuntan los workflows durante la
  // conversación—. Este sí se calla si falla: un aviso cada doce segundos
  // taparía el chat entero.
  useEffect(() => {
    if (!leadId || !verHistorial) return
    let vivo = true
    const t = setInterval(() => {
      leerFicha(leadId).then((f) => { if (vivo) setFicha(f) }).catch(() => {})
    }, 12_000)
    return () => { vivo = false; clearInterval(t) }
  }, [leadId, verHistorial, leerFicha])

  const refrescarFicha = useCallback(() => {
    const id = lead?.id
    if (!id) return
    leerFicha(id)
      .then(setFicha)
      .catch(() => toast.error("No se pudo releer la ficha del lead"))
  }, [lead?.id, leerFicha])

  async function handleCrear() {
    const displayPhone = phone.startsWith("34") ? phone.slice(2) : phone
    startCreando(async () => {
      const res = await crearLeadDesdeChat(chatName ?? "Contacto", displayPhone)
        .catch(() => ({ error: "No se pudo crear el lead", leadId: undefined }))
      if (!res.leadId) {
        toast.error(res.error ?? "No se pudo crear el lead")
        return
      }

      // Cuando ya había un lead con ese teléfono la acción devuelve el suyo en
      // vez de crear otro. Hay que leer su fila: inventarle "Nuevo" y sin notas
      // enseñaba un estado que no era el suyo, y el siguiente clic lo guardaba.
      const { data } = await createClient()
        .from("leads")
        .select("id, nombre, apellidos, telefono, email, estado, notas, fuente, fecha_creacion, captacion_id")
        .eq("id", res.leadId)
        .maybeSingle()

      const nuevoLead: Lead = (data as Lead | null) ?? {
        id: res.leadId,
        nombre: chatName ?? "Contacto",
        apellidos: null,
        telefono: displayPhone,
        email: null,
        estado: "Nuevo",
        notas: null,
        fuente: "Mensajes",
        fecha_creacion: new Date().toISOString(),
        captacion_id: null,
      }
      if (res.error) toast.info(res.error)
      setLead(nuevoLead)
      setNotas(nuevoLead.notas ?? "")
      onLeadCreated(nuevoLead)
    })
  }

  async function guardarEstado(estado: EstadoLead, motivoPerdida: string | null) {
    if (!lead) return
    // Perdido sin motivo no sale de aquí ni por error de programación: la acción
    // también lo rechaza, pero así el botón nunca llega a pedirlo.
    if (estado === "Perdido" && !motivoPerdida) return toast.error("Di por qué se pierde")

    setUpdatingEstado(true)
    const res = await cambiarEstadoLead(lead.id, estado, motivoPerdida)
      .catch(() => ({ error: "No se pudo cambiar el estado" }))
    setUpdatingEstado(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    setLead((prev) => prev ? { ...prev, estado } : null)
    setFicha((f) => ({ ...f, motivo: estado === "Perdido" ? motivoPerdida : null }))
    setPidiendoMotivo(false)
    // El cambio deja una anotación: el historial abierto tiene que enseñarla ya.
    refrescarFicha()
  }

  async function handleEstado(estado: EstadoLead) {
    if (!lead || updatingEstado) return
    // Perder sin motivo lo rechaza la acción, así que se pregunta antes de
    // guardar en vez de dejar que falle. Volver a pulsar "Perdido" reabre el
    // recuadro a propósito: los leads que se perdieron antes de esto no tienen
    // motivo, y si el botón se ignorase por estar ya puesto no habría manera de
    // ponérselo. Salir de Perdido no pregunta nada: la acción limpia el motivo.
    if (estado === "Perdido") {
      setMotivo(ficha.motivo ?? "")
      setPidiendoMotivo(true)
      return
    }
    if (estado === lead.estado) return
    setPidiendoMotivo(false)
    await guardarEstado(estado, null)
  }

  async function handleGuardarNotas() {
    if (!lead) return
    setSavingNotas(true)
    const res = await actualizarNotasLead(lead.id, notas)
      .catch(() => ({ error: "No se pudieron guardar las notas" }))
    setSavingNotas(false)
    // Antes no se miraba qué contestaba: el recuadro se cerraba y el texto se
    // quedaba en pantalla como guardado aunque no hubiera llegado a la base.
    if (res.error) return toast.error(res.error)
    setLead((prev) => prev ? { ...prev, notas: notas || null } : null)
    setEditandoNotas(false)
  }

  if (!lead) {
    return (
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
        <p className="text-xs text-muted-foreground">Sin lead asociado</p>
        <button
          onClick={handleCrear}
          disabled={creando}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Crear lead
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-b border-border bg-violet-500/5">
      {/* Header del lead */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-violet-500/10">
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500 via-cyan-400 to-emerald-400 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {lead.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">
            {lead.nombre}{lead.apellidos ? ` ${lead.apellidos}` : ""}
          </span>
          {lead.fuente && <span className="text-[10px] text-muted-foreground ml-1.5">· {lead.fuente}</span>}
        </div>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0", ESTADO_CFG[lead.estado].badge)}>
          {ESTADO_CFG[lead.estado].label}
        </span>
        <Link
          href="/leads"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Ver en Leads"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex flex-col gap-2 px-4 py-2">
        {/* Etiquetas */}
        {catalogosListos && (
          <EtiquetasLead key={lead.id} leadId={lead.id} puestas={ficha.etiquetas} catalogos={catalogos} />
        )}

        {/* Estados */}
        <div className="flex gap-1 flex-wrap">
          {ESTADOS.map((e) => {
            const puesto = lead.estado === e
            const pendiente = pidiendoMotivo && e === "Perdido"
            return (
              <button
                key={e}
                onClick={() => handleEstado(e)}
                disabled={updatingEstado}
                aria-pressed={puesto}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded border font-medium transition-all",
                  puesto || pendiente
                    ? ESTADO_CFG[e].badge
                    : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                  pendiente && !puesto && "ring-1 ring-violet-500/40"
                )}
              >
                {ESTADO_CFG[e].label}
              </button>
            )
          })}
        </div>

        {/* Motivo de pérdida */}
        {pidiendoMotivo && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 animate-in fade-in-0 slide-in-from-top-1 duration-150">
            <span className="text-[11px] font-semibold text-foreground">¿Por qué se pierde?</span>

            {!catalogosListos ? (
              <span className="text-[11px] text-muted-foreground">Cargando motivos…</span>
            ) : motivosPerdida.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">
                Todavía no hay motivos.{" "}
                <Link
                  href="/configuracion/catalogos"
                  className="font-medium text-violet-500 underline-offset-2 hover:underline"
                >
                  Crear el primero
                </Link>
              </span>
            ) : (
              <select
                value={motivoElegido}
                onChange={(ev) => setMotivo(ev.target.value)}
                aria-label="Motivo de pérdida"
                className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-violet-500/60"
              >
                {motivosPerdida.map((m) => (
                  <option key={m.id} value={m.valor}>{m.nombre}</option>
                ))}
              </select>
            )}

            <button
              onClick={() => guardarEstado("Perdido", motivoElegido)}
              disabled={updatingEstado || !motivoElegido}
              className="flex items-center gap-1 h-7 px-2.5 rounded-md bg-violet-500 hover:bg-violet-600 text-[11px] font-medium text-white transition-colors disabled:opacity-40"
            >
              {updatingEstado && <Loader2 className="h-3 w-3 animate-spin" />}
              Guardar
            </button>
            <button
              onClick={() => setPidiendoMotivo(false)}
              aria-label="Cancelar"
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {lead.estado === "Perdido" && !pidiendoMotivo && ficha.motivo && (
          <p className="text-[11px] text-muted-foreground">
            Perdido por <span className="text-foreground">{nombreDe(catalogos, "motivo_perdida", ficha.motivo)}</span>
          </p>
        )}

        {/* Notas */}
        {editandoNotas ? (
          <div className="flex items-start gap-1.5">
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Añade notas..."
              className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <div className="flex flex-col gap-1 shrink-0 pt-0.5">
              <button
                onClick={handleGuardarNotas}
                disabled={savingNotas}
                className="p-1 rounded text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
              >
                {savingNotas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => { setEditandoNotas(false); setNotas(lead.notas ?? "") }}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditandoNotas(true); setNotas(lead.notas ?? "") }}
            className="w-full text-left group"
          >
            {lead.notas ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 group-hover:text-foreground transition-colors">
                {lead.notas}
              </p>
            ) : (
              <span className="text-[11px] text-muted-foreground/40 italic flex items-center gap-1 group-hover:text-muted-foreground transition-colors">
                <Pencil className="h-3 w-3" /> Añadir notas...
              </span>
            )}
          </button>
        )}

        {/* Historial */}
        <button
          onClick={() => setVerHistorial((v) => !v)}
          aria-expanded={verHistorial}
          className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="h-3 w-3" />
          {verHistorial ? "Ocultar historial" : "Ver historial"}
          {ficha.interacciones.length > 0 && (
            <span className="tabular-nums">({ficha.interacciones.length})</span>
          )}
        </button>

        {/* El historial se pliega porque esta ficha vive encima del chat: abierto
            de serie dejaría los mensajes en una rendija. */}
        {verHistorial && (
          <div className="max-h-[45vh] overflow-y-auto scrollbar-thin animate-in fade-in-0 slide-in-from-top-1 duration-150">
            <LineaTiempo
              interacciones={ficha.interacciones}
              catalogos={catalogos}
              personas={personas}
              yoId={yo.id}
              isAdmin={yo.isAdmin}
              leadId={lead.id}
              // Apuntar y borrar aquí no recargan nada por su cuenta —esta lista
              // la pide el propio panel—, así que avisa y se vuelve a leer. Antes
              // se adivinaba con un setTimeout al enviar el formulario: llegaba
              // tarde o pronto según tardara el servidor, y los borrados, que no
              // pasan por el formulario, no refrescaban nunca.
              onCambio={refrescarFicha}
            />
          </div>
        )}
      </div>
    </div>
  )
}
