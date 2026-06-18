import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { getConversaciones, getTelefonosAgente } from "@/lib/actions/mensajes"
import { MensajesShell } from "@/components/mensajes/mensajes-shell"
import { MessageSquare } from "lucide-react"

export const metadata = { title: "Mensajes — mkgenia" }

export default async function MensajesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", user.id)
    .single()

  const isAdmin = perfil?.rol === "Admin"

  let chats: Awaited<ReturnType<typeof getConversaciones>> = []
  let errorMsg: string | null = null

  try {
    if (isAdmin) {
      chats = await getConversaciones()
    } else {
      const telefonos = await getTelefonosAgente(user.id)
      chats = await getConversaciones(telefonos)
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : "Error desconocido"
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8">
        <MessageSquare className="h-10 w-10 opacity-20" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-foreground">No se pudo conectar con Evolution API</p>
          <p className="text-xs opacity-70">{errorMsg}</p>
          <p className="text-xs">Verifica que <code className="bg-muted px-1 rounded">EVO_API_URL</code>, <code className="bg-muted px-1 rounded">EVO_API_KEY</code> y <code className="bg-muted px-1 rounded">EVO_INSTANCE</code> estén configurados en <code className="bg-muted px-1 rounded">.env.local</code></p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-8 min-h-0">
      <div className="mb-8 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Mensajes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {chats.length} conversaciones de WhatsApp
          </p>
        </div>
      </div>

      <MensajesShell chats={chats} />
    </div>
  )
}
