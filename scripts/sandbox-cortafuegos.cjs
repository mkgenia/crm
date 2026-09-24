// ============================================================================
// CORTAFUEGOS DE SALIDA para la copia local del CRM contra el SANDBOX.
//
// Qué hace: antes de que arranque Next, sustituye fetch() y https.request() del
// proceso de Node por una versión que SOLO deja salir hacia una lista cerrada de
// destinos. Todo lo demás (Evolution API, n8n, Apify, OpenAI, Brevo, Meta...)
// falla como si no hubiera red, ANTES de abrir ninguna conexión.
//
// Por qué hace falta aunque se sobreescriban las variables de entorno:
// src/lib/actions/mensajes.ts y whatsapp-status.ts llevan la URL de Evolution y
// las claves de instancia ESCRITAS EN EL CÓDIGO. Vaciar EVO_API_URL no las para:
// el botón de enviar de /mensajes seguiría mandando WhatsApps de verdad.
//
// Cómo se usa (PowerShell, en la carpeta del CRM):
//   Lo pone `scripts/sandbox-dev.cjs`: no hace falta ejecutarlo a mano.
// Al arrancar, cada proceso de Node imprime "[cortafuegos] activo". Si no sale
// esa línea, NO se empieza la simulación.
//
// Lo que se permite y por qué:
//   · Supabase del proyecto: es la base de datos que se está probando.
//   · CartoCiudad y Catastro: el valorador geocodifica con APIs públicas y
//     gratuitas; no escriben nada ni avisan a nadie.
//   · img*.idealista.com: el valorador copia a Storage las fotos de comparables.
//   · Google Fonts: next/font descarga la tipografía al compilar.
//   · loopback (localhost / 127.x): el propio servidor.
// Evolution en modo lectura (ver conversaciones) se puede abrir con
// CORTAFUEGOS_EVO_LECTURA=1; ni así pasan sendText, connect ni nada que escriba.
// ============================================================================
"use strict"

const PROYECTO = "gxnwtxvcyosccbofpcjb.supabase.co"   // SANDBOX, nunca producción

const PERMITIDOS = [
  (u) => u.protocol === "https:" && u.host === PROYECTO,
  (u) => u.protocol === "https:" && u.host === "www.cartociudad.es" && u.pathname.startsWith("/geocoder/"),
  (u) => u.protocol === "https:" && u.host === "ovc.catastro.meh.es",
  (u) => u.protocol === "https:" && /^img\d*\.idealista\.com$/.test(u.host),
  (u) => u.protocol === "https:" && (u.host === "fonts.googleapis.com" || u.host === "fonts.gstatic.com"),
  (u) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname),
]

// Lectura de Evolution, sólo si se pide expresamente. Nunca envío ni conexión.
const EVO_HOST = "test-evolution-api.pzkz6e.easypanel.host"
const EVO_LECTURA = /^\/(chat\/findChats|chat\/findMessages|instance\/connectionState)\//

// [crítica 17/09] El host de Supabase estaba permitido ENTERO, y desde ese mismo
// host salen correos (Auth: invitaciones, enlaces mágicos, recuperar contraseña),
// se borran cuentas y se ejecutan Edge Functions. Dentro del proyecto se cierra
// todo eso; REST, RPC, lectura de Auth, refresco de token y Storage siguen abiertos.
function supabaseVetado(u, metodo) {
  if (u.host !== PROYECTO) return false
  const p = u.pathname
  const m = String(metodo || "GET").toUpperCase()
  if (p.startsWith("/functions/v1/")) return true                                   // Edge Functions
  if (/^\/auth\/v1\/(invite|otp|magiclink|recover|signup|resend)\b/.test(p)) return true // envían correo
  if (p.startsWith("/auth/v1/admin/") && m !== "GET") return true                  // crear/borrar/invitar usuarios
  if (p === "/auth/v1/user" && m === "PUT") return true                           // cambiar contraseña o correo
  if (p.startsWith("/storage/v1/object") && m === "DELETE") return true            // borrar fotos (compartidas)
  return false
}

function permitido(url, metodo) {
  let u
  try { u = new URL(String(url)) } catch { return false }
  if (supabaseVetado(u, metodo)) return false
  if (PERMITIDOS.some((f) => f(u))) return true
  if (process.env.CORTAFUEGOS_EVO_LECTURA === "1" && u.host === EVO_HOST && EVO_LECTURA.test(u.pathname)) {
    return true
  }
  return false
}

function avisar(metodo, url) {
  let limpio = String(url)
  try { const u = new URL(limpio); limpio = u.origin + u.pathname } catch {}
  // Sin query string: ahí viajan a veces tokens (Apify, Meta).
  console.error(`[cortafuegos] BLOQUEADO ${metodo} ${limpio}`)
}

// ---- fetch -----------------------------------------------------------------
const fetchOriginal = globalThis.fetch
if (typeof fetchOriginal === "function" && !globalThis.__cortafuegosActivo) {
  globalThis.fetch = function fetchConCortafuegos(input, init) {
    const url = typeof input === "string" ? input : (input && (input.url || input.href)) || String(input)
    const metodo = ((init && init.method) || (input && input.method) || "GET").toUpperCase()
    if (!permitido(url, metodo)) {
      avisar(metodo, url)
      return Promise.reject(new TypeError("fetch failed [cortafuegos de la simulación]"))
    }
    return fetchOriginal.apply(this, arguments)
  }
}

// ---- https.request / https.get ---------------------------------------------
const https = require("https")
function envolver(nombre) {
  const original = https[nombre]
  https[nombre] = function (...args) {
    let url
    const a = args[0]
    if (typeof a === "string" || a instanceof URL) url = String(a)
    else if (a && typeof a === "object") url = `https://${a.hostname || a.host || "desconocido"}${a.path || "/"}`
    const metodo = ((a && a.method) || (args[1] && args[1].method) || "GET").toUpperCase()
    if (!url || !permitido(url, metodo)) {
      avisar(metodo, url)
      throw new Error("https bloqueado [cortafuegos de la simulación]")
    }
    return original.apply(this, args)
  }
}
if (!globalThis.__cortafuegosActivo) { envolver("request"); envolver("get") }

globalThis.__cortafuegosActivo = true
console.error(`[cortafuegos] activo (pid ${process.pid})` +
  (process.env.CORTAFUEGOS_EVO_LECTURA === "1" ? " — Evolution sólo lectura" : " — Evolution cerrado"))

module.exports = { permitido }
