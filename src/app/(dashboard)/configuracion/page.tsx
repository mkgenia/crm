import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ThemeToggle } from "./theme-toggle"
import { PerfilForm } from "./perfil-form"

export const metadata = { title: "Configuración — mkgenia" }

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("nombre, apellidos, telefono, rol")
    .eq("id", user.id)
    .single()

  return (
    <div className="p-8 max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestiona tu perfil y preferencias del panel</p>
      </div>

      {/* Perfil */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Mi perfil</h2>
        <PerfilForm
          nombre={perfil?.nombre ?? ""}
          apellidos={perfil?.apellidos ?? null}
          telefono={perfil?.telefono ?? null}
          email={user.email ?? ""}
        />
      </section>

      {/* Apariencia */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Apariencia</h2>
        <div className="border border-border rounded-lg bg-card divide-y divide-border">
          <ThemeToggle />
        </div>
      </section>

      {/* Automatizaciones — solo admin */}
      {perfil?.rol === "Admin" && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Automatizaciones</h2>
          <div className="border border-border rounded-lg bg-card divide-y divide-border">
            <div className="px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Configuración del scraper</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gestiona las zonas de búsqueda y el auto-contacto desde la sección de Captaciones
                </p>
              </div>
              <a
                href="/captaciones"
                className="shrink-0 h-9 flex items-center px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Ir a Captaciones →
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
