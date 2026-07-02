"use client"

import { useEffect, useRef, useState } from "react"
import { MapContainer, TileLayer, useMap, Polygon } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet-draw/dist/leaflet.draw.css"
import { Plus, Minus, Pencil, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

// Assign L to window so leaflet-draw can find it
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).L = L
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("leaflet-draw")
}

// Fix default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

// ─── Google Polyline encoding (Idealista shape= format) ───────────────────────
export function encodePolyline(coords: [number, number][]) {
  const encode = (num: number) => {
    let v = Math.round(num * 1e5)
    v = v < 0 ? ~(v << 1) : v << 1
    let s = ""
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    s += String.fromCharCode(v + 63)
    return s
  }
  let lastLat = 0, lastLng = 0, result = ""
  for (const [lat, lng] of coords) {
    result += encode(lat - lastLat) + encode(lng - lastLng)
    lastLat = lat; lastLng = lng
  }
  return result
}

// ─── Polygon overlay for existing zones ──────────────────────────────────────
function ZonaPolygon({ coords, fitBounds }: { coords: [number, number][] | null | undefined; fitBounds?: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (fitBounds && coords && coords.length > 2) {
      const bounds = L.latLngBounds(coords.map(([lat, lng]) => L.latLng(lat, lng)))
      map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [coords, fitBounds, map])
  if (!coords || coords.length < 3) return null
  return <Polygon positions={coords} pathOptions={{ color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.15, weight: 2 }} />
}

// ─── Draw controls (inside MapContainer) ─────────────────────────────────────
function DrawControls({ onCreated, onClear, clearSignal }: {
  onCreated: (coords: [number, number][]) => void
  onClear: () => void
  clearSignal: number
}) {
  const map = useMap()
  const [isDrawing, setIsDrawing] = useState(false)
  const featureGroupRef = useRef<L.FeatureGroup>(new L.FeatureGroup())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawHandlerRef = useRef<any>(null)

  useEffect(() => {
    const fg = featureGroupRef.current
    map.addLayer(fg)
    const handleCreated = (e: any) => {
      const layer = e.layer
      fg.clearLayers()
      fg.addLayer(layer)
      const latlngs = layer.getLatLngs()[0]
      const coords: [number, number][] = latlngs.map((ll: any) => [ll.lat, ll.lng])
      coords.push(coords[0])
      onCreated(coords)
      setIsDrawing(false)
    }
    map.on("draw:created", handleCreated)
    return () => {
      map.off("draw:created", handleCreated)
      map.removeLayer(fg)
      if (drawHandlerRef.current) { drawHandlerRef.current.disable(); drawHandlerRef.current = null }
    }
  }, [map, onCreated])

  useEffect(() => {
    featureGroupRef.current.clearLayers()
    if (drawHandlerRef.current) { drawHandlerRef.current.disable(); drawHandlerRef.current = null }
    setIsDrawing(false)
  }, [clearSignal])

  const startDrawing = () => {
    if (drawHandlerRef.current) drawHandlerRef.current.disable()
    drawHandlerRef.current = new (L.Draw as any).Polygon(map, {
      allowIntersection: false,
      shapeOptions: { color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.15, weight: 2 },
    })
    drawHandlerRef.current.enable()
    setIsDrawing(true)
  }
  const stopDrawing = () => { drawHandlerRef.current?.disable(); drawHandlerRef.current = null; setIsDrawing(false) }
  const clearLayers = () => { featureGroupRef.current.clearLayers(); onClear() }

  return (
    <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
      {/* Zoom */}
      <div className="flex flex-col rounded-xl overflow-hidden shadow-md border border-border bg-card/90 backdrop-blur-sm">
        <button onClick={() => map.zoomIn()} className="h-9 w-9 flex items-center justify-center text-foreground hover:bg-muted border-b border-border transition-colors">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={() => map.zoomOut()} className="h-9 w-9 flex items-center justify-center text-foreground hover:bg-muted transition-colors">
          <Minus className="h-4 w-4" />
        </button>
      </div>
      {/* Draw */}
      <div className="flex flex-col rounded-xl overflow-hidden shadow-md border border-border bg-card/90 backdrop-blur-sm">
        <button
          onClick={isDrawing ? stopDrawing : startDrawing}
          title={isDrawing ? "Cancelar dibujo" : "Dibujar polígono"}
          className={cn(
            "h-9 w-9 flex items-center justify-center border-b border-border transition-colors",
            isDrawing ? "bg-violet-500 text-white" : "text-foreground hover:bg-muted"
          )}
        >
          {isDrawing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </button>
        <button onClick={clearLayers} title="Borrar polígono" className="h-9 w-9 flex items-center justify-center text-red-500 hover:bg-red-500/10 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Exported map components ──────────────────────────────────────────────────
interface ZonaMapProps {
  existingCoords?: [number, number][] | null
  fitBounds?: boolean
}

export function ZonaViewMap({ existingCoords, fitBounds }: ZonaMapProps) {
  return (
    <MapContainer center={[39.469907, -0.376288]} zoom={13} zoomControl={false} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      {existingCoords && <ZonaPolygon key={JSON.stringify(existingCoords?.[0])} coords={existingCoords} fitBounds={fitBounds} />}
    </MapContainer>
  )
}

interface ZonaDrawMapProps {
  onCreated: (coords: [number, number][]) => void
  onClear: () => void
  clearSignal: number
}

export function ZonaDrawMap({ onCreated, onClear, clearSignal }: ZonaDrawMapProps) {
  return (
    <MapContainer center={[39.469907, -0.376288]} zoom={13} zoomControl={false} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <DrawControls onCreated={onCreated} onClear={onClear} clearSignal={clearSignal} />
    </MapContainer>
  )
}
