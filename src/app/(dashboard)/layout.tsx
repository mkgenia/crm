import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/components/shared/sidebar"
import { OnboardingTour } from "@/components/shared/onboarding-tour"
import { NotificacionesAsignacion } from "@/components/shared/notificaciones-asignacion"
import { PERMISOS_DEFAULT } from "@/types/database"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("nombre, rol, permisos, avatar_url, onboarding_done")
    .eq("id", user.id)
    .single()

  if (!perfil) redirect("/login")

  const isAdmin = perfil.rol === "Admin"

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        rol={perfil.rol}
        permisos={perfil.permisos ?? PERMISOS_DEFAULT}
        nombre={perfil.nombre}
        avatar_url={perfil.avatar_url}
      />
      <main className="flex-1 overflow-y-auto flex flex-col">
        {children}
      </main>
      {!perfil.onboarding_done && (
        <OnboardingTour isAdmin={isAdmin} nombre={perfil.nombre} />
      )}
      {!isAdmin && (
        <NotificacionesAsignacion userId={user.id} />
      )}
    </div>
  )
}
