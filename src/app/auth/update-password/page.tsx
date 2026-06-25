'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function normalizeAuthError(message: string) {
  const m = message.toLowerCase()

  if (m.includes('expired') || m.includes('token has expired')) {
    return 'Il link è scaduto. Richiedine uno nuovo.'
  }

  if (m.includes('password') && (m.includes('short') || m.includes('length') || m.includes('characters'))) {
    return 'La password deve essere di almeno 8 caratteri.'
  }

  if (m.includes('invalid') || m.includes('token')) {
    return 'Link non valido. Richiedine uno nuovo.'
  }

  return message
}

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const run = async () => {
      // When redirected from Supabase recovery link, the session is established via URL hash.
      // We can just check whether we have a user.
      try {
        const { data } = await supabase.auth.getUser()
        setReady(Boolean(data.user))
      } catch {
        setReady(false)
      }
    }

    run()
  }, [supabase])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri.')
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non coincidono.')
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setSuccess(true)
      router.push('/login?toast=Password%20aggiornata!')
      router.refresh()
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Errore durante l'aggiornamento password."
      setError(normalizeAuthError(raw))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -bottom-44 -right-40 h-[560px] w-[560px] rounded-full bg-blue-600/18 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center justify-center px-6">
        <Card className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_120px_-60px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <div className="flex flex-col items-center mb-6">
            <div className="w-full flex items-center justify-center">
              <img src="/mirax-logo-footer.svg?v=2" alt="MiraX" style={{ width: '240px', height: 'auto' }} />
            </div>
            <div className="mt-2 text-sm text-white/60">Aggiorna password</div>
          </div>

          {!ready ? (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3 rounded-xl">
                Link non valido o scaduto. Richiedine uno nuovo.
              </div>
              <Button asChild variant="secondary" className="rounded-2xl">
                <Link href="/auth/reset-password">Richiedi nuovo link</Link>
              </Button>
            </div>
          ) : success ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-xl">
              Password aggiornata!
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/80">Nuova password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 rounded-2xl border-white/10 bg-slate-950/40 text-white placeholder:text-white/30"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/80">Conferma password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 rounded-2xl border-white/10 bg-slate-950/40 text-white placeholder:text-white/30"
                  required
                  autoComplete="new-password"
                />
              </div>

              {error ? (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3 rounded-xl">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={loading}
                className={`h-12 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 shadow-[0_18px_60px_-20px_rgba(124,58,237,0.65)] transition-all duration-200 ${
                  loading ? 'opacity-75 cursor-not-allowed' : 'hover:from-violet-700 hover:to-blue-700'
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Salvataggio…
                  </span>
                ) : (
                  'Aggiorna password'
                )}
              </Button>

              <div className="text-center text-sm text-white/60">
                <Link href="/login" className="underline underline-offset-4 hover:text-white">
                  Torna al login
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
