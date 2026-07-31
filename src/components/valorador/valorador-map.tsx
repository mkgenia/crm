"use client"

import { useEffect, useMemo } from "react"
import { MapContainer, TileLayer, GeoJSON, Circle, CircleMarker, Tooltip, useMap, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import type { Feature, FeatureCollection, Geometry } from "geojson"
import type { Layer, PathOptions } from "leaflet"
import type { ZonaStat } from "@/lib/actions/valorador"

// Fuerza el recálculo de tamaño cuando el contenedor cambia (montaje, resize de
// ventana, o al abrir/cerrar el panel lateral que encoge el mapa)
function InvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0)
    const onResize = () => map.invalidateSize()
    window.addEventListener("resize", onResize)
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => {
      clearTimeout(t)
      window.removeEventListener("resize", onResize)
      ro.disconnect()
    }
  }, [map])
  return null
}

export interface BarrioProps {
  codbarrio: string
  nombre: string
  distrito: string | null
}

// Escala de color verde (barato) -> rojo (caro) en función del €/m².
function colorFor(value: number | null, min: number, max: number): string {
  if (value == null) return "#3f3f46" // zinc-700: sin datos
  if (max <= min) return "hsl(140 60% 45%)"
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const hue = 140 - t * 140 // 140=verde -> 0=rojo
  return `hsl(${hue} 65% 48%)`
}

// Recentra el mapa cuando cambia el punto de valoración
function RecenterOn({ centro }: { centro: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (centro) map.setView(centro, 15, { animate: true })
  }, [centro, map])
  return null
}

// Captura clics en el mapa (para colocar el punto de valoración)
function MapClickHandler({ enabled, onMapClick }: { enabled: boolean; onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { if (enabled && onMapClick) onMapClick(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

export interface CompPunto { id: number; lat: number; lng: number; precio_m2: number }

interface Props {
  geojson: FeatureCollection<Geometry, BarrioProps>
  statsByBarrio: Record<string, ZonaStat>
  selected: string | null
  onSelectZona: (codbarrio: string, nombre: string) => void
  centro?: [number, number] | null
  radio?: number
  valuationMode?: boolean
  onMapClick?: (lat: number, lng: number) => void
  comparables?: CompPunto[]
  excludedIds?: Set<number>
  onToggleComparable?: (id: number) => void
}

export function ValoradorMapa({
  geojson, statsByBarrio, selected, onSelectZona, centro = null, radio = 0,
  valuationMode = false, onMapClick, comparables = [], excludedIds, onToggleComparable,
}: Props) {
  // Rango de precios de los comparables mostrados (para colorear los puntos)
  const [cMin, cMax] = useMemo(() => {
    const vals = comparables.map((c) => c.precio_m2).filter((v) => v != null)
    if (!vals.length) return [0, 0]
    return [Math.min(...vals), Math.max(...vals)]
  }, [comparables])
  // Rango de medianas para la escala de color
  const [min, max] = useMemo(() => {
    const vals = Object.values(statsByBarrio)
      .map((s) => s.precio_m2_mediana)
      .filter((v): v is number => v != null)
    if (!vals.length) return [0, 0]
    return [Math.min(...vals), Math.max(...vals)]
  }, [statsByBarrio])

  const styleFor = (feature?: Feature<Geometry, BarrioProps>): PathOptions => {
    const cod = feature?.properties?.codbarrio ?? ""
    const stat = statsByBarrio[cod]
    const isSel = selected === cod
    return {
      fillColor: colorFor(stat?.precio_m2_mediana ?? null, min, max),
      fillOpacity: stat ? (isSel ? 0.85 : 0.6) : 0.25,
      color: isSel ? "#ffffff" : "#00000055",
      weight: isSel ? 2.5 : 0.8,
    }
  }

  const onEachFeature = (feature: Feature<Geometry, BarrioProps>, layer: Layer) => {
    const p = feature.properties
    const stat = statsByBarrio[p.codbarrio]
    const precio = stat?.precio_m2_mediana
    const tooltip = precio
      ? `<strong>${p.nombre}</strong><br/>${precio.toLocaleString("es-ES")} €/m² · ${stat.muestra} comp.`
      : `<strong>${p.nombre}</strong><br/><span style="opacity:.6">Sin datos</span>`
    layer.bindTooltip(tooltip, { sticky: true, direction: "top", opacity: 0.95 })
    layer.on({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      click: (e: any) => {
        if (valuationMode) onMapClick?.(e.latlng.lat, e.latlng.lng)
        else onSelectZona(p.codbarrio, p.nombre)
      },
    })
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[39.469907, -0.376288]}
        zoom={12}
        zoomControl={false}
        style={{ height: "100%", width: "100%", background: "transparent" }}
      >
        <InvalidateOnMount />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <GeoJSON
          key={`${Object.keys(statsByBarrio).length}-${selected}-${valuationMode}`}
          data={geojson}
          style={styleFor as never}
          onEachFeature={onEachFeature as never}
        />
        <MapClickHandler enabled={valuationMode} onMapClick={onMapClick} />
        <RecenterOn centro={centro} />

        {/* Comparables como puntos (coloreados por €/m²) */}
        {comparables.map((c) => {
          const excluded = excludedIds?.has(c.id)
          return (
            <CircleMarker
              key={c.id}
              center={[c.lat, c.lng]}
              radius={5}
              pathOptions={{
                color: "#ffffff",
                weight: 1,
                fillColor: excluded ? "#71717a" : colorFor(c.precio_m2, cMin, cMax),
                fillOpacity: excluded ? 0.25 : 0.9,
              }}
              eventHandlers={{ click: () => onToggleComparable?.(c.id) }}
            >
              <Tooltip direction="top" opacity={0.95}>
                {Math.round(c.precio_m2).toLocaleString("es-ES")} €/m²{excluded ? " · excluido" : ""}
              </Tooltip>
            </CircleMarker>
          )
        })}

        {centro && radio > 0 && (
          <>
            <Circle
              center={centro}
              radius={radio}
              pathOptions={{ color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.08, weight: 2 }}
            />
            <CircleMarker
              center={centro}
              radius={7}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#8b5cf6", fillOpacity: 1 }}
            />
          </>
        )}
      </MapContainer>

      {/* Leyenda */}
      {max > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-border bg-card/90 backdrop-blur-sm px-3 py-2 text-xs shadow-md">
          <p className="font-medium text-foreground mb-1">€/m² (mediana)</p>
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-muted-foreground">{Math.round(min).toLocaleString("es-ES")}</span>
            <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, hsl(140 65% 48%), hsl(70 65% 48%), hsl(0 65% 48%))" }} />
            <span className="tabular-nums text-muted-foreground">{Math.round(max).toLocaleString("es-ES")}</span>
          </div>
        </div>
      )}
    </div>
  )
}
