"use server"

const EVO_URL = "https://test-evolution-api.pzkz6e.easypanel.host"

const INSTANCE_KEYS: Record<string, string> = {
  Demandas: "39E7987E01C4-4117-94EF-9FBE92EDECF1",
  demo: "CB475A12852B-4DF3-86BA-4B8B379C7064",
}

function headers(instance: string) {
  const key = INSTANCE_KEYS[instance] ?? process.env.EVO_API_KEY ?? ""
  return { "Content-Type": "application/json", apikey: key }
}

export type InstanceState = "open" | "close" | "connecting" | "unknown"

export async function getInstanceStatus(instance: string): Promise<InstanceState> {
  try {
    const res = await fetch(`${EVO_URL}/instance/connectionState/${instance}`, {
      headers: headers(instance),
      cache: "no-store",
    })
    if (!res.ok) return "unknown"
    const data = await res.json()
    const state = data?.instance?.state ?? data?.state ?? "unknown"
    return state as InstanceState
  } catch {
    return "unknown"
  }
}

export async function getInstanceQR(instance: string): Promise<{ base64: string | null; error: string | null }> {
  try {
    const res = await fetch(`${EVO_URL}/instance/connect/${instance}`, {
      headers: headers(instance),
      cache: "no-store",
    })
    const text = await res.text()
    console.log(`[EVO QR ${instance}] status=${res.status} body=${text.slice(0, 500)}`)
    if (!res.ok) return { base64: null, error: `Error ${res.status}: ${text.slice(0, 200)}` }
    const data = JSON.parse(text)
    // Evolution API v1/v2 formats
    const b64 =
      data?.base64 ??
      data?.qrcode?.base64 ??
      data?.code ?? // sometimes returns raw QR code string
      null
    return { base64: b64, error: null }
  } catch (e) {
    return { base64: null, error: String(e) }
  }
}
