"use client"

import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light"

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (t: Theme) => void
}>({ theme: "dark", setTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark")

  useEffect(() => {
    const saved = localStorage.getItem("mkgenia-theme") as Theme | null
    if (saved === "light" || saved === "dark") {
      setThemeState(saved)
      applyTheme(saved)
    } else {
      applyTheme("dark")
    }
  }, [])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem("mkgenia-theme", t)
    applyTheme(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === "light") {
    root.classList.add("light")
    root.classList.remove("dark")
  } else {
    root.classList.add("dark")
    root.classList.remove("light")
  }
}

export const useTheme = () => useContext(ThemeContext)
