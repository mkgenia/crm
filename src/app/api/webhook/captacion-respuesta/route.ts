import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

function clasificarRespuesta(texto: string): "Interesado" | "Callback" | "No_Interesado" | "Respondido" {
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
  if (callback.some((k) => t.includes(k))) return "Callback"
  if (positivos.some((k) => t.includes(k))) return "Interesado"
  return "Respondido"
}

// Mapeo estado_whatsapp → estado unificado
const WA_TO_LEAD_ESTADO: Record<string, string> = {
  Enviado:        "Contactado",
  Respondido:     "Contactado",
  Interesado:     "Interesado",
  Quiere_Llamada: "Interesado",
  Callback:       "Interesado",
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
    const { data } = await supabase
      .from("captaciones")
      .select("id")
      .ilike("telefono", `%${phone}`)
      .neq("estado_whatsapp", "Pendiente")
      .eq("activo", true)
      .limit(1)
      .single()
    captacionId = data?.id ?? null
  }

  if (!captacionId) {
    return NextResponse.json({ error: "Captación no encontrada" }, { status: 404 })
  }

  // Determinar clasificación
  const ESTADOS_VALIDOS = ["Interesado", "Callback", "No_Interesado", "Respondido", "Sin_Clasificar"]
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
    Callback:       "Interesado",
    No_Interesado:  "Perdido",
  }

  // 1. Actualizar captación
  const capUpdate: Record<string, string> = { estado_whatsapp: nuevoEstado }
  if (WA_TO_CRM[nuevoEstado]) capUpdate.estado_crm = WA_TO_CRM[nuevoEstado]

  const { data: captacion } = await supabase
    .from("captaciones")
    .update(capUpdate)
    .eq("id", captacionId)
    .select("nombre, telefono, agente_id")
    .single()

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
        fuente: "Captacion",
        estado: leadEstado,
        captacion_id: captacionId,
        captado_por: captacion.agente_id ?? null,
      })
    }
  }

  // 3. Historial
  const historial = [
    { captacion_id: captacionId, campo: "estado_whatsapp", valor_anterior: "Enviado", valor_nuevo: nuevoEstado, tipo_entidad: "captacion" },
    ...(nuevoEstado === "No_Interesado"
      ? [{ captacion_id: captacionId, campo: "estado_crm", valor_anterior: null, valor_nuevo: "No_Captado", tipo_entidad: "captacion" }]
      : []),
    ...((nuevoEstado === "Interesado" || nuevoEstado === "Callback")
      ? [{ captacion_id: captacionId, campo: "estado_crm", valor_anterior: null, valor_nuevo: "En_Seguimiento", tipo_entidad: "captacion" }]
      : []),
  ]
  await supabase.from("historial_cambios").insert(historial)

  revalidatePath("/captaciones")
  revalidatePath("/leads")
  return NextResponse.json({ success: true, captacion_id: captacionId, clasificacion: nuevoEstado })
}
