"use client"

import { useState } from "react"
import { completarOnboarding } from "@/lib/actions/usuarios"
import { Home, Users, MessageCircle, Bell, ArrowRight, X, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface Step {
  icon: React.ReactNode
  color: string
  title: string
  description: string
  tip?: string
}

const STEPS_AGENT: Step[] = [
  {
    icon: <Home className="h-8 w-8" />,
    color: "text-violet-500",
    title: "Tus captaciones",
    description: "Aquí verás las propiedades que el admin te asigne. Cada una tiene el estado del contacto por WhatsApp y la visita programada.",
    tip: "Si ves la pantalla vacía, es porque aún no tienes propiedades asignadas. El admin lo hará en breve.",
  },
  {
    icon: <Users className="h-8 w-8" />,
    color: "text-cyan-500",
    title: "Tus leads",
    description: "Los leads son propietarios que han mostrado interés. Aparecen automáticamente cuando alguien responde al WhatsApp con interés, o puedes crearlos manualmente.",
    tip: "Usa el botón 'Nuevo lead' para añadir un contacto que hayas conseguido por teléfono o en persona.",
  },
  {
    icon: <Bell className="h-8 w-8" />,
    color: "text-emerald-500",
    title: "Alertas WhatsApp",
    description: "Cuando un propietario responde 'Interesado' o 'Quiere llamada', verás un punto verde pulsante en el menú de Captaciones.",
    tip: "Responde cuanto antes — los propietarios interesados son la prioridad.",
  },
  {
    icon: <MessageCircle className="h-8 w-8" />,
    color: "text-orange-500",
    title: "Contacto automático",
    description: "El sistema envía WhatsApps automáticamente a los propietarios. Tu trabajo es hacer el seguimiento de los que responden.",
    tip: "Puedes ver el estado de cada contacto en la tarjeta de la captación.",
  },
]

const STEPS_ADMIN: Step[] = [
  {
    icon: <Home className="h-8 w-8" />,
    color: "text-violet-500",
    title: "Captaciones automáticas",
    description: "El scraper de Idealista importa propiedades y les envía WhatsApp automáticamente. Tú asignas las que respondan a los agentes.",
    tip: "Configura las zonas de búsqueda y el auto-contacto desde el botón de configuración en esta misma pantalla.",
  },
  {
    icon: <Users className="h-8 w-8" />,
    color: "text-cyan-500",
    title: "Gestión del equipo",
    description: "Desde 'Equipo' puedes invitar agentes por email. Recibirán un enlace para crear su contraseña y acceder directamente.",
    tip: "Asigna captaciones a los agentes usando las casillas de selección múltiple en la lista.",
  },
  {
    icon: <Bell className="h-8 w-8" />,
    color: "text-emerald-500",
    title: "Panel de control",
    description: "El dashboard muestra en tiempo real captaciones activas, leads, interesados y el rendimiento de cada agente.",
    tip: "Los KPIs son clicables — te llevan directamente a la lista filtrada correspondiente.",
  },
  {
    icon: <MessageCircle className="h-8 w-8" />,
    color: "text-orange-500",
    title: "Flujo completo",
    description: "Idealista → scraper → WhatsApp automático → clasificación IA → alerta al agente → seguimiento CRM. Todo conectado.",
    tip: "Si algo falla, revisa el estado de los workflows en n8n.",
  },
]

interface Props {
  isAdmin: boolean
  nombre: string | null
}

export function OnboardingTour({ isAdmin, nombre }: Props) {
  const [step, setStep] = useState(0)
  const [closing, setClosing] = useState(false)

  const steps = isAdmin ? STEPS_ADMIN : STEPS_AGENT
  const current = steps[step]
  const isLast = step === steps.length - 1

  async function handleDone() {
    setClosing(true)
    await completarOnboarding()
  }

  if (closing) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-violet-500 transition-all duration-500"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Paso {step + 1} de {steps.length}
          </span>
          <button
            onClick={handleDone}
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          {/* Welcome header — solo en el paso 0 */}
          {step === 0 && (
            <div className="mb-2">
              <h2 className="text-xl font-semibold text-foreground">
                Bienvenido{nombre ? `, ${nombre}` : ""} 👋
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Te explicamos cómo funciona el sistema en 4 pasos.
              </p>
            </div>
          )}

          {/* Step card */}
          <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
            <div className={cn("w-fit", current.color)}>
              {current.icon}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{current.title}</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{current.description}</p>
            </div>
            {current.tip && (
              <div className="flex items-start gap-2 bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2.5">
                <CheckCircle className="h-3.5 w-3.5 text-violet-500 mt-0.5 shrink-0" />
                <p className="text-xs text-violet-400 leading-relaxed">{current.tip}</p>
              </div>
            )}
          </div>

          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 pt-1">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={cn(
                  "rounded-full transition-all",
                  i === step
                    ? "w-5 h-1.5 bg-violet-500"
                    : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                )}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="h-10 px-4 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
              >
                Atrás
              </button>
            )}
            <button
              onClick={isLast ? handleDone : () => setStep(step + 1)}
              className="flex-1 h-10 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isLast ? (
                <>Empezar <CheckCircle className="h-4 w-4" /></>
              ) : (
                <>Siguiente <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
