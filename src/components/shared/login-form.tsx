"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

export function LoginForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ email: "", password: "" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    })

    if (error) {
      toast.error("Credenciales incorrectas", { description: "Revisa tu email y contraseña." })
      setLoading(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-white/70 text-xs uppercase tracking-wide">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="tu@email.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
          autoComplete="email"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[oklch(0.65_0.22_295/0.6)] focus:bg-white/8"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-white/70 text-xs uppercase tracking-wide">
          Contraseña
        </Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          required
          autoComplete="current-password"
          className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[oklch(0.65_0.22_295/0.6)]"
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-white text-black hover:bg-white/90 font-semibold mt-2"
        disabled={loading}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  )
}
