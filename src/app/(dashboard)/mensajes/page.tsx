import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { getConversaciones, getTelefonosAgente } from "@/lib/actions/mensajes"
import { INSTANCIAS } from "@/lib/instancias"
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

  const chatsPorInstancia: Record<string, Awaited<ReturnType<typeof getConversaciones>>> = {}
  const errores: string[] = []

  await Promise.all(
    INSTANCIAS.map(async ({ id }) => {
      try {
        if (isAdmin) {
          chatsPorInstancia[id] = await getConversaciones(id)
        } else {
          const telefonos = await getTelefonosAgente(user.id)
          chatsPorInstancia[id] = await getConversaciones(id, telefonos)
        }
      } catch (e) {
        errores.push(`${id}: ${e instanceof Error ? e.message : "Error desconocido"}`)
        chatsPorInstancia[id] = []
      }
    })
  )

  const totalChats = Object.values(chatsPorInstancia).reduce((s, c) => s + c.length, 0)

  if (totalChats === 0 && errores.length === INSTANCIAS.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8">
        <MessageSquare className="h-10 w-10 opacity-20" />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-foreground">No se pudo conectar con Evolution API</p>
          {errores.map((e, i) => <p key={i} className="text-xs opacity-70">{e}</p>)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-8 min-h-0">
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-semibold">Mensajes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {totalChats} conversaciones de WhatsApp
        </p>
      </div>

      <MensajesShell chatsPorInstancia={chatsPorInstancia} instancias={[...INSTANCIAS]} />
    </div>
  )
}
