"use client"

import { useCallback, useEffect, useState } from "react"
import { getInstanceStatus, getInstanceQR, type InstanceState } from "@/lib/actions/whatsapp-status"

interface Props {
  instance: string
  label: string
}

export function WhatsappStatus({ instance, label }: Props) {
  const [state, setState] = useState<InstanceState>("unknown")
  const [qr, setQr] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [checking, setChecking] = useState(true)

  const checkStatus = useCallback(async () => {
    const s = await getInstanceStatus(instance)
    setState(s)
    setChecking(false)
    if (s === "open") setQr(null)
  }, [instance])

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 10000)
    return () => clearInterval(interval)
  }, [checkStatus])

  const handleGetQR = async () => {
    setLoadingQr(true)
    setQrError(null)
    const { base64, error } = await getInstanceQR(instance)
    setQr(base64)
    setQrError(error)
    setLoadingQr(false)
  }

  const isConnected = state === "open"

  return (
    <div className="px-5 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              checking
                ? "bg-muted-foreground animate-pulse"
                : isConnected
                ? "bg-emerald-500"
                : "bg-red-500"
            }`}
          />
          <p className="text-sm font-medium">{label}</p>
          <span className="text-xs text-muted-foreground">
            {checking ? "Comprobando…" : isConnected ? "Conectado" : "Desconectado"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 ml-4">Instancia: {instance}</p>

        {/* QR */}
        {!isConnected && qr && (
          <div className="mt-3 ml-4">
            <p className="text-xs text-muted-foreground mb-2">
              Escanea el QR desde WhatsApp → Dispositivos vinculados → Vincular dispositivo
            </p>
            <img
              src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
              alt="QR WhatsApp"
              className="w-48 h-48 rounded-lg border border-border"
            />
            <p className="text-xs text-muted-foreground mt-2">El QR caduca en ~20 s — pulsa Regenerar si expira</p>
          </div>
        )}
        {!isConnected && qrError && (
          <p className="mt-2 ml-4 text-xs text-red-400 break-all">{qrError}</p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">
        <button
          onClick={checkStatus}
          className="h-8 flex items-center px-3 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all"
        >
          Actualizar
        </button>

        {!isConnected && (
          <button
            onClick={handleGetQR}
            disabled={loadingQr}
            className="h-8 flex items-center px-3 rounded-md border border-emerald-500/40 text-xs text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/70 transition-all disabled:opacity-50"
          >
            {loadingQr ? "Generando…" : qr ? "Regenerar QR" : "Conectar (QR)"}
          </button>
        )}
      </div>
    </div>
  )
}
