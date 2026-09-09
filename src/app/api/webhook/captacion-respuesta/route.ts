import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// OJO: los valores de retorno tienen que estar en la CHECK constraint de
// captaciones.estado_whatsapp. La migración 001 renombró "Callback" a "Quiere_Llamada"
// pero este fichero se quedó con el nombre viejo, así que cada propietario que pedía
// una llamada provocaba un UPDATE rechazado por Postgres... que además se descartaba
// sin mirar el error, y se quedaba en "Enviado".
function clasificarRespuesta(texto: string): "Interesado" | "Quiere_Llamada" | "No_Interesado" | "Respondido" {
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

  const positivos = [
    "si", "sí", "claro", "perfecto", "de acuerdo", "me interesa", "interesado",
    "quiero", "adelante", "cuando podemos", "cuando puedo", "que precio",
    "mas info", "más info", "informacion", "información", "enviame", "envíame",
    "me gustaria", "me gustaría", "podemos hablar", "hablamos", "ok",
  ]
  const callback = [
    "llamame", "llámame", "llama", "llamar", "me puedes llamar", "puedes llamar",
    "prefiero hablar", "prefiero llamar", "al telefono", "al teléfono",
    "por telefono", "por teléfono", "mejor llamada",
  ]
  const negativos = [
    "no", "no gracias", "no me interesa", "no quiero", "no estoy interesado",
    "ya esta vendido", "ya vendido", "ya lo vendí", "error", "equivocado",
    "numero equivocado", "no es correcto", "baja mi numero", "baja mi número",
    "no molestar", "no contactar", "stop", "bloquear",
  ]

  if (negativos.some((k) => t.includes(k))) return "No_Interesado"
  if (callback.some((k) => t.includes(k))) return "Quiere_Llamada"
  if (positivos.some((k) => t.includes(k))) return "Interesado"
  return "Respondido"
}

// Mapeo estado_whatsapp → estado unificado
const WA_TO_LEAD_ESTADO: Record<string, string> = {
  Enviado:        "Contactado",
  Respondido:     "Contactado",
  Interesado:     "Interesado",
  Quiere_Llamada: "Interesado",

  No_Interesado:  "Perdido",
}

// POST /api/webhook/captacion-respuesta
// Body: { telefono?, captacion_id?, mensaje_respuesta?, clasificacion? }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret")
  if (secret !== process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const supabase = await createAdminClient()

  let captacionId: number | null = body.captacion_id ?? null

  if (!captacionId && body.telefono) {
    const phone = String(body.telefono).replace(/\D/g, "").slice(-9)
    // Sin este corte, un teléfono vacío deja el filtro en ilike "%", que casa con
    // cualquier fila y aplicaría la clasificación a una captación al azar.
    if (phone.length < 9) {
      return NextResponse.json({ error: "Teléfono no válido" }, { status: 400 })
    }
    const { data } = await supabase
      .from("captaciones")
      .select("id")
      .ilike("telefono", `%${phone}`)
      .eq("activo", true)
      // Un particular puede tener dos anuncios con el mismo teléfono: gana aquel al
      // que se escribió más recientemente, que es el que provocó la respuesta.
      .order("ultimo_contacto_en", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    captacionId = data?.id ?? null
  }

  if (!captacionId) {
    return NextResponse.json({ error: "Captación no encontrada" }, { status: 404 })
  }

  // Determinar clasificación
  const ESTADOS_VALIDOS = ["Interesado", "Quiere_Llamada", "No_Interesado", "Respondido", "Sin_Clasificar"]
  let nuevoEstado: string
  if (body.clasificacion && ESTADOS_VALIDOS.includes(body.clasificacion)) {
    nuevoEstado = body.clasificacion === "Sin_Clasificar" ? "Respondido" : body.clasificacion
  } else if (body.mensaje_respuesta) {
    nuevoEstado = clasificarRespuesta(String(body.mensaje_respuesta))
  } else {
    nuevoEstado = "Respondido"
  }

  // Solo clasificaciones definitivas cambian el estado CRM. Respondido/Enviado no retroceden.
  const WA_TO_CRM: Record<string, string> = {
    Interesado:     "Interesado",
    Quiere_Llamada: "Interesado",

    No_Interesado:  "Perdido",
  }

  // 1. Actualizar captación
  const capUpdate: Record<string, string> = { estado_whatsapp: nuevoEstado }
  if (WA_TO_CRM[nuevoEstado]) capUpdate.estado_crm = WA_TO_CRM[nuevoEstado]

  const { data: captacion, error: errUpdate } = await supabase
    .from("captaciones")
    .update(capUpdate)
    .eq("id", captacionId)
    .select("nombre, telefono, agente_id")
    .maybeSingle()

  // Descartar este error es lo que hacía que un valor rechazado por la CHECK
  // constraint se perdiera en silencio: la respuesta devolvía 200 y el historial
  // registraba un cambio que nunca llegó a la columna.
  if (errUpdate) {
    return NextResponse.json(
      { error: "No se pudo actualizar la captación", detalle: errUpdate.message },
      { status: 500 },
    )
  }

  // 2. Crear o actualizar lead vinculado a esta captación
  const leadEstado = WA_TO_LEAD_ESTADO[nuevoEstado] ?? "Contactado"

  if (captacion) {
    const { data: leadExistente } = await supabase
      .from("leads")
      .select("id, estado")
      .eq("captacion_id", captacionId)
      .maybeSingle()

    if (leadExistente) {
      // Solo actualizar si el nuevo estado es "más avanzado" o es Perdido
      const ORDEN: Record<string, number> = {
        Nuevo: 0, Contactado: 1, Interesado: 2, Propuesta: 3, Negociacion: 4, Ganado: 5, Perdido: 6,
      }
      const avanza = (ORDEN[leadEstado] ?? 0) > (ORDEN[leadExistente.estado] ?? 0)
      const esPerdido = leadEstado === "Perdido"
      if (avanza || esPerdido) {
        await supabase.from("leads").update({ estado: leadEstado }).eq("id", leadExistente.id)
      }
    } else {
      // Crear nuevo lead desde la captación
      await supabase.from("leads").insert({
        nombre: captacion.nombre ?? "Propietario",
        telefono: captacion.telefono,
        fuente: "Captaciones",
        estado: leadEstado,
        captacion_id: captacionId,
        captado_por: captacion.agente_id ?? null,
      })
    }
  }

  // 3. Historial.
  // Se registra el valor que REALMENTE se ha escrito en la columna. Antes ponía
  // "No_Captado" y "En_Seguimiento", que no existen en EstadoCRM y contradecían lo
  // que WA_TO_CRM acababa de guardar ("Perdido" e "Interesado").
  const historial = [
    { captacion_id: captacionId, campo: "estado_whatsapp", valor_anterior: null, valor_nuevo: nuevoEstado, tipo_entidad: "captacion" },
    ...(capUpdate.estado_crm
      ? [{ captacion_id: captacionId, campo: "estado_crm", valor_anterior: null, valor_nuevo: capUpdate.estado_crm, tipo_entidad: "captacion" }]
      : []),
  ]
  await supabase.from("historial_cambios").insert(historial)

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return NextResponse.json({ success: true, captacion_id: captacionId, clasificacion: nuevoEstado })
}
