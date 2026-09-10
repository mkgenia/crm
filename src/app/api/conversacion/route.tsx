import { ImageResponse } from "next/og"
import { NextRequest, NextResponse } from "next/server"

/**
 * Convierte una conversación de WhatsApp en un PNG.
 *
 * Lo llama n8n cuando un propietario dice que sí. La imagen lleva SÓLO la
 * conversación: el nombre, el teléfono, el inmueble y el enlace van en el
 * mensaje que la acompaña, donde se pueden tocar y copiar. Dibujar esos datos
 * dentro de la foto los convertiría en píxeles.
 *
 * Se renderiza aquí y no en n8n porque n8n no sabe dibujar, y montarlo en un
 * servicio externo de HTML-a-imagen sería pagar y mandar fuera conversaciones
 * de clientes por un recuadro con burbujas.
 *
 * Si esto falla o no está desplegado, n8n manda el aviso en texto: el aviso
 * nunca depende de que la imagen salga.
 */

export const runtime = "nodejs"

interface Mensaje {
  quien: string
  txt: string
  hora?: string
}

interface Cuerpo {
  mensajes?: Mensaje[]
}

const ANCHO = 760
const MARGEN = 22
const BURBUJA_MAX = Math.round((ANCHO - MARGEN * 2) * 0.8)
// Ancho medio de carácter a 17px en la Noto Sans que trae ImageResponse. Se usa
// sólo para calcular el alto del lienzo, que Satori exige fijo de antemano.
const CHAR_PX = 8.3
const LINEA_PX = 23

/**
 * Satori no incrusta emojis: sin un proveedor externo salen como cuadrados. Se
 * quitan. Si un mensaje era sólo un emoji —un pulgar arriba es un "sí" y no se
 * puede perder— queda el hueco marcado en vez de una burbuja vacía.
 */
function limpiar(txt: string): string {
  const sinEmoji = String(txt ?? "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .trim()
  return sinEmoji || "[emoji]"
}

function lineasDe(txt: string): number {
  return txt
    .split("\n")
    .reduce((n, linea) => n + Math.max(1, Math.ceil((linea.length * CHAR_PX) / (BURBUJA_MAX - 28))), 0)
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret")
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  let cuerpo: Cuerpo
  try {
    cuerpo = (await req.json()) as Cuerpo
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const mensajes = (cuerpo.mensajes ?? [])
    .filter((m) => m && m.txt)
    .slice(-10)
    .map((m) => ({
      mio: m.quien === "Agente",
      txt: limpiar(m.txt),
      hora: m.hora ?? "",
    }))

  if (!mensajes.length) {
    return NextResponse.json({ error: "Sin mensajes que dibujar" }, { status: 400 })
  }

  // Satori exige el alto por adelantado, así que se estima. Se estima por lo
  // alto a propósito: pasarse deja un poco de fondo de más al final, quedarse
  // corto recorta el último mensaje del propietario, que es justo el que importa.
  const alto = Math.min(
    2200,
    MARGEN * 2 +
      mensajes.reduce((h, m) => h + lineasDe(m.txt) * LINEA_PX + 42 + (m.hora ? 16 : 0), 0)
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: ANCHO,
          height: alto,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#e9e2d9",
          padding: `${MARGEN}px`,
        }}
      >
        {mensajes.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.mio ? "flex-end" : "flex-start",
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxWidth: BURBUJA_MAX,
                backgroundColor: m.mio ? "#d9fdd3" : "#ffffff",
                borderRadius: 10,
                padding: "9px 14px",
              }}
            >
              <div style={{ display: "flex", fontSize: 17, color: "#111b21", lineHeight: 1.35 }}>
                {m.txt}
              </div>
              {m.hora ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    fontSize: 11,
                    color: "#667781",
                    paddingTop: 2,
                  }}
                >
                  {m.hora}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    ),
    { width: ANCHO, height: alto }
  )
}
