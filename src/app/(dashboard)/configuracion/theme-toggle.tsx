"use client"

import { useTheme } from "@/components/shared/theme-provider"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3">
        {theme === "dark" ? (
          <Moon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Sun className="h-4 w-4 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">Tema</p>
          <p className="text-xs text-muted-foreground">
            {theme === "dark" ? "Modo oscuro activo" : "Modo claro activo"}
          </p>
        </div>
      </div>

      {/* Toggle visual */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border"
        aria-label="Cambiar tema"
      >
        <span
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
            theme === "light"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          }`}
        >
          <Sun className="h-3.5 w-3.5" /> Claro
        </span>
        <span
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
            theme === "dark"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          }`}
        >
          <Moon className="h-3.5 w-3.5" /> Oscuro
        </span>
      </button>
    </div>
  )
}
