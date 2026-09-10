import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Una cookie de sesión caducada, o de un despliegue anterior, hace que Supabase
  // lance "Invalid Refresh Token: Refresh Token Not Found". Sin capturarla, la
  // excepción sube hasta el runtime y llena el log del contenedor, aunque para el
  // usuario el efecto correcto sea simplemente volver a /login. Se trata como
  // "no hay sesión", que es lo que significa.
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
    // Y se tira la cookie que ha fallado. Sin esto el navegador la vuelve a mandar
    // en cada petición y el error se repite indefinidamente: el log seguiría igual
    // de sucio y el usuario no saldría nunca del bucle de /login.
    for (const c of request.cookies.getAll()) {
      if (c.name.startsWith("sb-") && c.name.includes("auth-token")) {
        supabaseResponse.cookies.delete(c.name)
      }
    }
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login")
  const isDashboardRoute = !isAuthRoute && request.nextUrl.pathname !== "/"

  if (!user && isDashboardRoute) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|geojson|json|xml|txt)$).*)"],
}
