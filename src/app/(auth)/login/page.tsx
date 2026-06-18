import Image from "next/image"
import { LoginForm } from "@/components/shared/login-form"

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Panel izquierdo — branding */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden">
        {/* Glow de fondo */}
        <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.65_0.22_295/0.15)] via-[oklch(0.80_0.15_200/0.08)] to-transparent pointer-events-none" />
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[oklch(0.65_0.22_295/0.12)] blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-[oklch(0.80_0.15_200/0.10)] blur-3xl pointer-events-none" />

        {/* Border derecho */}
        <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[oklch(0.65_0.22_295/0.3)] to-transparent" />

        <div className="relative">
          <Image src="/logo.png" alt="mkgenia" width={120} height={30} priority />
        </div>

        <div className="relative space-y-4">
          <p className="text-5xl font-semibold text-white leading-tight">
            Tu panel de<br />
            gestión<br />
            <span className="holo-text">inmobiliaria.</span>
          </p>
          <p className="text-sm text-white/30 max-w-xs leading-relaxed">
            Leads, captaciones y mensajes — todo centralizado para tu equipo.
          </p>
        </div>

        <p className="text-xs text-white/15 relative">© {new Date().getFullYear()} mkgenia</p>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Image src="/logo.png" alt="mkgenia" width={100} height={25} />
          </div>

          <h1 className="text-2xl font-semibold text-white mb-1">Iniciar sesión</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Introduce tus credenciales para acceder
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
