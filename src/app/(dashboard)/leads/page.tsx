"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { crearLead, actualizarLead } from "@/lib/actions/leads"
import { Search, ChevronDown, X, Plus, UserCircle, Pencil, Check, Loader2 } from "lucide-react"
import type { EstadoLead } from "@/types/captaciones"

const ESTADOS: EstadoLead[] = ["Nuevo", "Contactado", "Interesado", "Propuesta", "Negociacion", "Ganado", "Perdido"]

const ESTADO_CFG: Record<EstadoLead, { badge: string; label: string; dot: string }> = {
  Nuevo:       { badge: "bg-violet-500/10 text-violet-500 border-violet-500/20",    dot: "bg-violet-400",    label: "Nuevo" },
  Contactado:  { badge: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",          dot: "bg-cyan-400",      label: "Contactado" },
  Interesado:  { badge: "bg-blue-500/10 text-blue-500 border-blue-500/20",          dot: "bg-blue-400",      label: "Interesado" },
  Propuesta:   { badge: "bg-orange-500/10 text-orange-500 border-orange-500/20",    dot: "bg-orange-400",    label: "Propuesta" },
  Negociacion: { badge: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",    dot: "bg-yellow-400",    label: "Negociación" },
  Ganado:      { badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", dot: "bg-emerald-400",   label: "Ganado" },
  Perdido:     { badge: "bg-muted text-muted-foreground border-border",             dot: "bg-muted-foreground", label: "Perdido" },
}

const FUENTES = ["Manual", "Web", "Captaciones", "Referido", "Redes sociales", "Llamada", "Otro"]

interface Lead {
  id: string
  nombre: string
  apellidos: string | null
  email: string | null
  telefono: string | null
  fuente: string | null
  estado: EstadoLead
  notas: string | null
  fecha_creacion: string
  captado_por: string | null
  captacion_id: number | null
  agente: { nombre: string; apellidos: string | null } | null
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return new Date(date).toLocaleDateString("es", { day: "numeric", month: "short" })
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<EstadoLead | "">("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Panel edición inline
  const [editando, setEditando] = useState(false)
  const [editTel, setEditTel] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editNotas, setEditNotas] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  // Modal nuevo lead
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const supabase = createClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLeads = useCallback(async (uid: string, admin: boolean) => {
    setLoading(true)
    try {
      let query = supabase
        .from("leads")
        .select("id, nombre, apellidos, email, telefono, fuente, estado, notas, fecha_creacion, captado_por, captacion_id, agente:perfiles!leads_captado_por_fkey(nombre, apellidos)")
        .order("fecha_creacion", { ascending: false })

      if (!admin) {
        const { data: caps } = await supabase
          .from("captaciones")
          .select("id")
          .eq("agente_id", uid)
        const capIds = (caps ?? []).map((c: { id: number }) => c.id)

        if (capIds.length > 0) {
          query = query.or(`captado_por.eq.${uid},captacion_id.in.(${capIds.join(",")})`)
        } else {
          query = query.eq("captado_por", uid)
        }
      }

      if (estadoFilter) query = query.eq("estado", estadoFilter)
      if (search.trim()) {
        query = query.or(`nombre.ilike.%${search}%,apellidos.ilike.%${search}%,telefono.ilike.%${search}%`)
      }

      const { data } = await query.limit(500)
      const normalized = (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        agente: Array.isArray(row.agente) ? (row.agente[0] ?? null) : (row.agente ?? null),
      }))
      setLeads(normalized as Lead[])
    } catch {
      // silencioso — la lista queda vacía
    } finally {
      setLoading(false)
    }
  }, [estadoFilter, search])

  // Init: auth + datos iniciales (una sola vez)
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: perfil } = await supabase.from("perfiles").select("rol").eq("id", user.id).single()
      const admin = perfil?.rol === "Admin"
      setIsAdmin(admin)
      setUserId(user.id)
      // No llamamos fetchLeads aquí: el efecto de abajo se dispara al cambiar userId
    }
    init()
  }, [])

  // Refetch al cambiar filtros o al tener userId; debounce solo para búsqueda de texto
  useEffect(() => {
    if (userId === null) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const delay = search ? 300 : 0
    debounceRef.current = setTimeout(() => fetchLeads(userId, isAdmin), delay)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [estadoFilter, search, fetchLeads, userId, isAdmin])

  function abrirEdicion() {
    if (!selected) return
    setEditTel(selected.telefono ?? "")
    setEditEmail(selected.email ?? "")
    setEditNotas(selected.notas ?? "")
    setEditando(true)
  }

  async function guardarEdicion() {
    if (!selected) return
    setSavingEdit(true)
    const res = await actualizarLead(selected.id, {
      telefono: editTel.trim() || null,
      email: editEmail.trim() || null,
      notas: editNotas.trim() || null,
    })
    setSavingEdit(false)
    if (res.error) return
    const updated = { ...selected, telefono: editTel.trim() || null, email: editEmail.trim() || null, notas: editNotas.trim() || null }
    setSelected(updated)
    setLeads((prev) => prev.map((l) => l.id === selected.id ? updated : l))
    setEditando(false)
  }

  async function cambiarEstado(leadId: string, nuevoEstado: EstadoLead) {
    setUpdatingId(leadId)
    await supabase.from("leads").update({ estado: nuevoEstado }).eq("id", leadId)
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, estado: nuevoEstado } : l))
    if (selected?.id === leadId) setSelected((prev) => prev ? { ...prev, estado: nuevoEstado } : null)
    setUpdatingId(null)
  }

  async function handleCrearLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const fd = new FormData(e.currentTarget)
    const result = await crearLead(fd)
    setSaving(false)
    if (result.error) {
      setSaveError(result.error)
      return
    }
    setShowModal(false)
    formRef.current?.reset()
    if (userId) fetchLeads(userId, isAdmin)
  }

  const counts = ESTADOS.reduce((acc, e) => {
    acc[e] = leads.filter((l) => l.estado === e).length
    return acc
  }, {} as Record<EstadoLead, number>)

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: main list ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="p-8 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold">
                {isAdmin ? "Leads" : "Mis leads"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {loading ? "Cargando..." : `${leads.length} leads${leads.length === 500 ? " (límite alcanzado)" : ""}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 h-9 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-48"
                />
              </div>
              <div className="relative">
                <select
                  value={estadoFilter}
                  onChange={(e) => setEstadoFilter(e.target.value as EstadoLead | "")}
                  className="h-9 pl-3 pr-8 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
                >
                  <option value="">Todos los estados</option>
                  {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <button
                onClick={() => { setShowModal(true); setSaveError(null) }}
                className="h-9 flex items-center gap-1.5 px-3 text-sm rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo lead
              </button>
            </div>
          </div>

          {/* Pipeline strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-4 border-b border-border">
            <button
              onClick={() => setEstadoFilter("")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all ${
                estadoFilter === "" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-muted-foreground/40"
              }`}
            >
              Todos <span className="opacity-70 tabular-nums">{leads.length}</span>
            </button>
            {ESTADOS.map((e) => (
              <button
                key={e}
                onClick={() => setEstadoFilter(estadoFilter === e ? "" : e)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium whitespace-nowrap transition-all ${
                  estadoFilter === e ? ESTADO_CFG[e].badge : "border-border text-muted-foreground hover:border-muted-foreground/40"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${ESTADO_CFG[e].dot}`} />
                {ESTADO_CFG[e].label}
                <span className="tabular-nums opacity-70">{counts[e]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando leads...</div>
          ) : leads.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-4 text-center">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <UserCircle className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {search || estadoFilter ? "No hay leads con estos filtros" : "Aún no tienes leads"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {search || estadoFilter
                    ? "Prueba cambiando los filtros de búsqueda"
                    : "Los leads se crean automáticamente cuando un propietario responde, o puedes añadir uno manualmente"}
                </p>
              </div>
              {!search && !estadoFilter && (
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-4 w-4" />
                  Crear primer lead
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => { setSelected(selected?.id === lead.id ? null : lead); setEditando(false) }}
                  className={`w-full flex items-center gap-4 px-8 py-3.5 text-left transition-colors hover:bg-muted/40 ${selected?.id === lead.id ? "bg-muted/60" : ""}`}
                >
                  <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                    {lead.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.nombre}{lead.apellidos ? ` ${lead.apellidos}` : ""}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {lead.telefono && <span>{lead.telefono}</span>}
                      {lead.fuente && <span className="opacity-60">· {lead.fuente}</span>}
                      {isAdmin && lead.agente && (
                        <span className="opacity-60">· {lead.agente.nombre}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${ESTADO_CFG[lead.estado].badge}`}>
                    {ESTADO_CFG[lead.estado].label}
                  </span>
                  <span className="text-xs text-muted-foreground/50 w-8 text-right shrink-0 hidden sm:block">
                    {timeAgo(lead.fecha_creacion)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {selected && (
        <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground">Detalle</h2>
            <div className="flex items-center gap-2">
              {!editando ? (
                <button onClick={abrirEdicion} className="text-muted-foreground hover:text-foreground transition-colors" title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={guardarEdicion}
                  disabled={savingEdit}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar
                </button>
              )}
              <button onClick={() => { setSelected(null); setEditando(false) }} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-gradient-to-br from-[oklch(0.65_0.22_295)] via-[oklch(0.80_0.15_200)] to-[oklch(0.80_0.18_145)] text-white">
                {selected.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{selected.nombre} {selected.apellidos}</p>
                <p className="text-xs text-muted-foreground">{selected.fuente ?? "—"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contacto</p>
              {editando ? (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Teléfono</label>
                    <input
                      type="tel"
                      value={editTel}
                      onChange={(e) => setEditTel(e.target.value)}
                      placeholder="Sin teléfono"
                      className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Sin email"
                      className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {selected.telefono ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Teléfono</span>
                      <a href={`tel:${selected.telefono}`} className="text-foreground hover:underline">{selected.telefono}</a>
                    </div>
                  ) : null}
                  {selected.email ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Email</span>
                      <a href={`mailto:${selected.email}`} className="text-foreground hover:underline truncate">{selected.email}</a>
                    </div>
                  ) : null}
                  {!selected.telefono && !selected.email && (
                    <p className="text-muted-foreground/60 italic">Sin datos de contacto</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cambiar estado</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ESTADOS.map((e) => (
                  <button
                    key={e}
                    onClick={() => cambiarEstado(selected.id, e)}
                    disabled={updatingId === selected.id}
                    className={`text-xs px-2 py-1.5 rounded border font-medium transition-all ${
                      selected.estado === e
                        ? ESTADO_CFG[e].badge
                        : "border-border text-muted-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    {ESTADO_CFG[e].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notas</p>
              {editando ? (
                <textarea
                  value={editNotas}
                  onChange={(e) => setEditNotas(e.target.value)}
                  rows={4}
                  placeholder="Añade notas sobre este lead..."
                  className="w-full px-2.5 py-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              ) : selected.notas ? (
                <p className="text-xs text-foreground leading-relaxed bg-muted/50 rounded-md p-3">{selected.notas}</p>
              ) : (
                <p className="text-xs text-muted-foreground/60 italic">Sin notas</p>
              )}
            </div>

            <div className="space-y-1.5 pt-3 border-t border-border text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Creado</span>
                <span className="text-foreground">
                  {new Date(selected.fecha_creacion).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              {isAdmin && selected.agente && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agente</span>
                  <span className="text-foreground">{selected.agente.nombre}</span>
                </div>
              )}
              {selected.captacion_id && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Captación</span>
                  <span className="text-foreground font-mono">#{selected.captacion_id}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nuevo lead ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold">Nuevo lead</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form ref={formRef} onSubmit={handleCrearLead} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nombre <span className="text-red-400">*</span></label>
                  <input
                    name="nombre"
                    required
                    placeholder="Ej: Josep"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Apellidos</label>
                  <input
                    name="apellidos"
                    placeholder="Ej: García"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Teléfono</label>
                <input
                  name="telefono"
                  type="tel"
                  placeholder="Ej: 612345678"
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Origen</label>
                <select
                  name="fuente"
                  defaultValue="Manual"
                  className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {FUENTES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notas</label>
                <textarea
                  name="notas"
                  rows={3}
                  placeholder="Contexto del contacto, observaciones..."
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {saveError && (
                <p className="text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-2">{saveError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-9 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-9 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Crear lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
