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
        {/*
          EL TEMA, ANTES DE QUE SE PINTE NADA.

          Sin esto, quien tiene el tema claro guardado ve un fogonazo oscuro en
          cada carga: el HTML sale con `dark` puesto en <html> y la clase no se
          corrige hasta que React hidrata.

          Va como <script> plano en el <head> y no como <Script> de next/script.
          Estaba con strategy="beforeInteractive" dentro del <body>, y en el App
          Router eso lo renderiza React como un componente más: un <script>
          renderizado en el cliente NO SE EJECUTA, y Next lo canta en la consola
          ("Encountered a script tag while rendering React component"). O sea que
          justo el trozo que evita el parpadeo era el que podía no correr.

          En el <head> forma parte del HTML que manda el servidor y se ejecuta
          antes del primer pintado, que es la única forma de llegar a tiempo.
        */}
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
