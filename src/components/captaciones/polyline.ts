// Codificación polyline (algoritmo de Google) — función pura, sin dependencias de Leaflet.
// Vive fuera de zona-map.tsx para que importarla NO arrastre Leaflet al bundle del
// servidor (Leaflet toca `window` al evaluarse y rompe el SSR).
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
