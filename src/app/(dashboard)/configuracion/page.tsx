import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ThemeToggle } from "./theme-toggle"
import { PerfilForm } from "./perfil-form"
import { WhatsappStatus } from "./whatsapp-status"

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

  const isAdmin = perfil?.rol === "Admin"

  return (
    <div className="p-6 lg:p-8 max-w-7xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestiona tu perfil y preferencias del panel</p>
      </div>

      {/* Fila 1: Perfil + Apariencia */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Mi perfil</h2>
          <PerfilForm
            nombre={perfil?.nombre ?? ""}
            apellidos={perfil?.apellidos ?? null}
            telefono={perfil?.telefono ?? null}
            email={user.email ?? ""}
          />
        </section>

        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Apariencia</h2>
            <div className="border border-border rounded-lg bg-card divide-y divide-border">
              <ThemeToggle />
            </div>
          </section>

          {isAdmin && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Automatizaciones</h2>
              <div className="border border-border rounded-lg bg-card divide-y divide-border">
                <div className="px-5 py-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Configuración del scraper</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Gestiona las zonas de búsqueda y el auto-contacto desde Captaciones
                    </p>
                  </div>
                  <a
                    href="/captaciones"
                    className="shrink-0 h-9 flex items-center px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
                  >
                    Ir →
                  </a>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* WhatsApp — solo admin */}
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">WhatsApp</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-border rounded-lg bg-card">
              <WhatsappStatus instance="Demandas" label="Bot de demandas" />
            </div>
            <div className="border border-border rounded-lg bg-card">
              <WhatsappStatus instance="demo" label="Envío de captaciones" />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
