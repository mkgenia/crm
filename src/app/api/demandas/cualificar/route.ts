import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// POST /api/demandas/cualificar
// Body: { demanda_id, datos_cualificacion: { personas, ocupantes, edades, necesidades, mascotas, fumadores, plazo } }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret")
  if (secret !== process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { demanda_id, datos_cualificacion } = body

  if (!demanda_id) return NextResponse.json({ error: "demanda_id requerido" }, { status: 400 })

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("demandas")
    .update({
      datos_cualificacion,
      estado: "Cualificado",
    })
    .eq("id", demanda_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath("/demandas")
  return NextResponse.json({ success: true })
}
