"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowLeft, Printer } from "lucide-react"
import type { Valoracion } from "@/lib/actions/valorador"

function eur(n: number | null | undefined) {
  if (n == null) return "—"
  return `${Math.round(n).toLocaleString("es-ES")} €`
}

const COND_LABEL: Record<string, string> = {
  good: "Buen estado", renew: "A reformar", newdevelopment: "Obra nueva",
}
const ENERGIA_OK = ["a", "b", "c", "d", "e", "f", "g"]

export function InformeValoracion({ v }: { v: Valoracion }) {
  const fecha = new Date(v.creada_en)
  const comparables = v.comparables ?? []
  const m2 = v.metros ?? 0
  const pm2 = (n: number | null) => (n && m2 > 0 ? `${Math.round(n / m2).toLocaleString("es-ES")} €/m²` : "—")

  // Las notas guardan el resumen de características separado por comas
  const caracteristicas = (v.notas ?? "").split("—")[0].split(",").map((s) => s.trim()).filter(Boolean)
  const notaLibre = (v.notas ?? "").includes("—") ? v.notas!.split("—").slice(1).join("—").trim() : ""

  return (
    <>
      {/* Barra de acciones — no se imprime */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border bg-background/95 backdrop-blur">
        <Link href="/valorador" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Volver al valorador
        </Link>
        <button
          onClick={() => window.print()}
          className="h-9 flex items-center gap-1.5 px-4 text-sm rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
        >
          <Printer className="h-4 w-4" /> Descargar PDF
        </button>
      </div>

      {/* Hoja A4 */}
      <div className="informe mx-auto my-6 bg-white text-zinc-900 shadow-lg print:shadow-none print:my-0">
        {/* Cabecera */}
        <header className="flex items-start justify-between border-b-2 border-zinc-900 pb-4 mb-6">
          <div>
            <Image src="/logo.png" alt="mkgenia" width={130} height={33} priority />
            <p className="text-[10px] text-zinc-500 mt-1.5 tracking-wide">GESTIÓN INMOBILIARIA · VALENCIA</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight">INFORME DE VALORACIÓN</h1>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Ref. VAL-{String(v.id).padStart(5, "0")} · {fecha.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
        </header>

        {/* Datos del inmueble */}
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-zinc-500 mb-2">INMUEBLE</h2>
          <p className="text-xl font-semibold leading-tight">{v.direccion || v.barrio || "Inmueble"}</p>
          <p className="text-sm text-zinc-600 mt-0.5">
            {[v.barrio, "València"].filter(Boolean).join(" · ")}
          </p>
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              ["Superficie", v.metros ? `${v.metros} m²` : "—"],
              ["Habitaciones", v.habitaciones ?? "—"],
              ["Operación", v.operacion === "alquiler" ? "Alquiler" : "Venta"],
              ["Comparables", v.muestra ?? "—"],
            ].map(([k, val]) => (
              <div key={k as string} className="border border-zinc-200 rounded p-2.5">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{k}</p>
                <p className="text-base font-semibold mt-0.5">{val}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Valoración: las 3 bandas */}
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-zinc-500 mb-2">VALORACIÓN</h2>

          <div className="border-2 border-emerald-600 rounded-lg p-4 bg-emerald-50 mb-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-700 tracking-widest">PRECIO DE VENTA RECOMENDADO</p>
                <p className="text-3xl font-bold text-emerald-800 mt-1">{eur(v.valor_min)}</p>
              </div>
              <p className="text-sm text-emerald-700 font-medium">{pm2(v.valor_min)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-amber-400 rounded-lg p-3 bg-amber-50">
              <p className="text-[9px] font-bold text-amber-700 tracking-widest">VENTA POCO PROBABLE</p>
              <p className="text-xl font-bold text-amber-800 mt-0.5">{eur(v.valor_estimado)}</p>
              <p className="text-[11px] text-amber-700">{pm2(v.valor_estimado)}</p>
            </div>
            <div className="border border-red-400 rounded-lg p-3 bg-red-50">
              <p className="text-[9px] font-bold text-red-700 tracking-widest">FUERA DE MERCADO</p>
              <p className="text-xl font-bold text-red-800 mt-0.5">{eur(v.valor_max)}</p>
              <p className="text-[11px] text-red-700">{pm2(v.valor_max)}</p>
            </div>
          </div>
        </section>

        {/* Características consideradas */}
        {caracteristicas.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-bold tracking-widest text-zinc-500 mb-2">CARACTERÍSTICAS CONSIDERADAS</h2>
            <div className="flex flex-wrap gap-1.5">
              {caracteristicas.map((c, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded bg-zinc-100 border border-zinc-200">{c}</span>
              ))}
            </div>
          </section>
        )}

        {/* Metodología */}
        <section className="mb-6">
          <h2 className="text-[11px] font-bold tracking-widest text-zinc-500 mb-2">METODOLOGÍA</h2>
          <div className="text-[11px] text-zinc-700 leading-relaxed space-y-1.5">
            <p>
              Valoración por <strong>comparación de mercado</strong> sobre{" "}
              <strong>{v.muestra ?? "—"} inmuebles</strong> testigo de la zona
              {v.barrio ? <> (<strong>{v.barrio}</strong>)</> : null}, ponderados según su grado de
              semejanza con el inmueble valorado (superficie, distribución, estado de conservación,
              planta, ascensor, eficiencia energética, equipamiento y proximidad).
            </p>
            <p>
              Precio de referencia de la zona: <strong>{v.precio_m2_zona ? `${Math.round(v.precio_m2_zona).toLocaleString("es-ES")} €/m²` : "—"}</strong>.
              El precio de cada testigo se ha ajustado a las características del inmueble antes de
              obtener el valor final.
            </p>
            {notaLibre && <p className="pt-1"><strong>Observaciones:</strong> {notaLibre}</p>}
          </div>
        </section>

        {/* Aviso legal */}
        <section className="border-t border-zinc-200 pt-3 mb-6">
          <p className="text-[9px] text-zinc-500 leading-relaxed">
            <strong>Aviso:</strong> este informe es una estimación orientativa de valor de mercado
            elaborada a partir de precios de oferta publicados en portales inmobiliarios. No constituye
            una tasación oficial conforme a la Orden ECO/805/2003 ni es válido a efectos hipotecarios,
            judiciales o fiscales. El precio final de transacción depende de las condiciones concretas
            del inmueble, su estado de conservación y la negociación entre las partes.
          </p>
        </section>

        {/* Pie */}
        <footer className="flex items-end justify-between border-t-2 border-zinc-900 pt-3">
          <div className="text-[10px] text-zinc-600">
            <p className="font-semibold text-zinc-900">mkgenia · Gestión inmobiliaria</p>
            <p>València</p>
          </div>
          <div className="text-[10px] text-zinc-600 text-right">
            {v.autor && <p>Elaborado por <strong className="text-zinc-900">{v.autor.nombre} {v.autor.apellidos ?? ""}</strong></p>}
            <p>{fecha.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })} · Pág. 1/{comparables.length ? 2 : 1}</p>
          </div>
        </footer>
      </div>

      {/* ── HOJA 2: testigos comparados ── */}
      {comparables.length > 0 && (
        <div className="informe mx-auto my-6 bg-white text-zinc-900 shadow-lg print:shadow-none print:my-0 print:break-before-page">
          <header className="flex items-start justify-between border-b-2 border-zinc-900 pb-3 mb-5">
            <div>
              <Image src="/logo.png" alt="mkgenia" width={100} height={25} />
            </div>
            <div className="text-right">
              <h1 className="text-base font-bold tracking-tight">TESTIGOS COMPARABLES</h1>
              <p className="text-[10px] text-zinc-500">
                Ref. VAL-{String(v.id).padStart(5, "0")} · {comparables.length} inmuebles
              </p>
            </div>
          </header>

          <p className="text-[10px] text-zinc-600 mb-3 leading-relaxed">
            Inmuebles testigo empleados en la valoración, ordenados por grado de semejanza con el
            inmueble valorado. El precio de cada uno se ha ajustado a las características del
            inmueble objeto antes de calcular el valor final.
          </p>

          <table className="w-full text-[9.5px] border-collapse">
            <thead>
              <tr className="bg-zinc-100 text-left">
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold">#</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold">Zona</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-right">m²</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-center">Hab</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-center">Baños</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-center">Pl.</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold">Estado</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold">Equipamiento</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-right">Precio</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-right">€/m²</th>
                <th className="border border-zinc-300 px-1.5 py-1.5 font-bold text-center">Simil.</th>
              </tr>
            </thead>
            <tbody>
              {comparables.map((c, i) => (
                <tr key={i} className={i % 2 ? "bg-zinc-50" : ""}>
                  <td className="border border-zinc-300 px-1.5 py-1 text-zinc-500">{i + 1}</td>
                  <td className="border border-zinc-300 px-1.5 py-1">
                    {c.barrio ?? "—"}
                    {!c.activo && <span className="text-zinc-500"> (vendido)</span>}
                  </td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-right">{c.metros}</td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-center">{c.habitaciones ?? "—"}</td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-center">{c.banos ?? "—"}</td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-center">{c.planta ?? "—"}</td>
                  <td className="border border-zinc-300 px-1.5 py-1">
                    {COND_LABEL[c.estado ?? ""] ?? "—"}
                    {c.energia && ENERGIA_OK.includes(c.energia.toLowerCase())
                      ? ` · ${c.energia.toUpperCase()}` : ""}
                  </td>
                  <td className="border border-zinc-300 px-1.5 py-1">
                    {[c.ascensor ? "Ascensor" : null, ...c.extras].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-right font-medium">
                    {c.precio.toLocaleString("es-ES")} €
                  </td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-right">
                    {c.precio_m2.toLocaleString("es-ES")}
                  </td>
                  <td className="border border-zinc-300 px-1.5 py-1 text-center font-semibold">
                    {c.similitud}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Resumen estadístico */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {(() => {
              const pm2 = comparables.map((c) => c.precio_m2).sort((a, b) => a - b)
              const med = pm2[Math.floor(pm2.length / 2)]
              const media = Math.round(pm2.reduce((s, x) => s + x, 0) / pm2.length)
              return [
                ["Mínimo", `${pm2[0].toLocaleString("es-ES")} €/m²`],
                ["Mediana", `${med.toLocaleString("es-ES")} €/m²`],
                ["Media", `${media.toLocaleString("es-ES")} €/m²`],
                ["Máximo", `${pm2[pm2.length - 1].toLocaleString("es-ES")} €/m²`],
              ].map(([k, val]) => (
                <div key={k} className="border border-zinc-200 rounded p-2 text-center">
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{k}</p>
                  <p className="text-sm font-semibold mt-0.5">{val}</p>
                </div>
              ))
            })()}
          </div>

          <p className="text-[9px] text-zinc-500 mt-4 leading-relaxed">
            <strong>Fuente:</strong> anuncios publicados en Idealista, capturados en la fecha de este
            informe. Los precios corresponden a ofertas de venta, no a precios de transacción cerrada.
            Los inmuebles marcados como «vendido» han sido retirados del portal.
          </p>

          <footer className="flex items-end justify-between border-t-2 border-zinc-900 pt-3 mt-5">
            <div className="text-[10px] text-zinc-600">
              <p className="font-semibold text-zinc-900">mkgenia · Gestión inmobiliaria</p>
            </div>
            <p className="text-[10px] text-zinc-600">
              {fecha.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })} · Pág. 2/2
            </p>
          </footer>
        </div>
      )}

      <style jsx global>{`
        /* Hoja A4: 210 × 297 mm con márgenes de 18 mm (estándar de documento) */
        .informe {
          width: 210mm;
          min-height: 297mm;
          padding: 18mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }
        /* El pie siempre abajo del todo de la hoja */
        .informe > footer { margin-top: auto; }
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
          /* Oculta el layout del dashboard (sidebar, barra de acciones) */
          .no-print, aside, nav { display: none !important; }
          /* Neutraliza contenedores con scroll/altura fija del dashboard */
          body > div, main, main > div {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .informe {
            margin: 0 !important;
            box-shadow: none !important;
            break-after: page;
            page-break-after: always;
          }
          .informe:last-of-type { break-after: auto; page-break-after: auto; }
          table { page-break-inside: auto; }
          tr, thead { page-break-inside: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </>
  )
}
