import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// POST /api/demandas/nueva
// Body enviado por n8n Capturador de demandas:
// { type, server_url, instance, apikey, lead: { nombre, telefono, email, mensaje, referencia, codigoAnuncio, fuente }, propiedad: {...} | null }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret")
  if (secret !== process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const supabase = await createAdminClient()

  const lead = body.lead ?? body
  const propData = body.propiedad ?? null

  // Determinar la ref que identifica la propiedad
  const ref: string | null = propData?.ref || lead.referencia || lead.codigoAnuncio || null
  if (!ref) {
    return NextResponse.json({ error: "ref de propiedad requerida" }, { status: 400 })
  }

  // Buscar o crear propiedad
  let propiedadId: string | null = null
  const { data: existing } = await supabase
    .from("propiedades_demanda")
    .select("id")
    .eq("ref", ref)
    .maybeSingle()

  if (existing) {
    propiedadId = existing.id
    // Actualizar datos si tenemos info fresca del XML
    if (propData) {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const campos = ["tipo","accion","ciudad","zona","cp","precio_alquiler","precio_venta","habitaciones","banyos","m_construidos","titulo","descripcion","extras"]
      for (const c of campos) {
        const v = propData[c]
        if (v !== undefined && v !== null && v !== "" && v !== 0) updates[c] = v
      }
      await supabase.from("propiedades_demanda").update(updates).eq("id", propiedadId)
    }
  } else {
    const { data: created, error } = await supabase
      .from("propiedades_demanda")
      .insert({
        ref,
        tipo:            propData?.tipo            ?? null,
        accion:          propData?.accion          ?? null,
        ciudad:          propData?.ciudad          ?? null,
        zona:            propData?.zona            ?? null,
        cp:              propData?.cp              ?? null,
        precio_alquiler: propData?.precio_alquiler ?? 0,
        precio_venta:    propData?.precio_venta    ?? 0,
        habitaciones:    propData?.habitaciones    ?? 0,
        banyos:          propData?.banyos          ?? 0,
        m_construidos:   propData?.m_construidos   ?? 0,
        titulo:          propData?.titulo          ?? null,
        descripcion:     propData?.descripcion     ?? null,
        extras:          propData?.extras          ?? [],
      })
      .select("id")
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    propiedadId = created?.id ?? null
  }

  if (!propiedadId) {
    return NextResponse.json({ error: "No se pudo crear la propiedad" }, { status: 500 })
  }

  // Crear demanda
  const { data: demanda, error: demError } = await supabase
    .from("demandas")
    .insert({
      propiedad_id: propiedadId,
      nombre:   lead.nombre   || null,
      telefono: lead.telefono || null,
      email:    lead.email    || null,
      fuente:   lead.fuente   || "Otros",
      mensaje:  lead.mensaje  || null,
      estado:   "Nuevo",
      visto:    false,
    })
    .select("id")
    .single()

  if (demError) return NextResponse.json({ error: demError.message }, { status: 500 })

  revalidatePath("/demandas")
  return NextResponse.json({ success: true, demanda_id: demanda?.id, propiedad_id: propiedadId })
}
