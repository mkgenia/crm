import type { Metadata } from "next"
import { Hanken_Grotesk } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/shared/theme-provider"
import "./globals.css"

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "mkgenia CRM",
  description: "Panel de gestión inmobiliaria",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${hanken.variable} h-full antialiased dark`} suppressHydrationWarning>
      <head>
        {/* Evita flash al cargar: aplica el tema guardado antes de pintar */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('mkgenia-theme');var h=document.documentElement;if(t==='light'){h.classList.remove('dark');h.classList.add('light')}else{h.classList.add('dark');h.classList.remove('light')}})()`,
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
