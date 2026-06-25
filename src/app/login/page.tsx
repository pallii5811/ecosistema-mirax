'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Clear previous session data to avoid stale data from other accounts
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('ckb_query')
        sessionStorage.removeItem('ckb_results')
        sessionStorage.removeItem('ckb_filters')
        sessionStorage.removeItem('ckb_aiDebug')
      }

      if (mode === 'signup') {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
        if (!siteUrl) {
          throw new Error('Missing NEXT_PUBLIC_SITE_URL env var')
        }

        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${siteUrl}/auth/confirm`,
          },
        })

        if (signUpError) throw signUpError

        // Send welcome email (fire and forget)
        fetch('/api/welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }).catch(() => {})

        // Show confirmation screen instead of redirecting
        setConfirmationSent(true)
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Errore di autenticazione'
      const normalized = rawMessage.toLowerCase()
      const isInvalidCredentials =
        normalized.includes('invalid login credentials') ||
        normalized.includes('invalid credentials') ||
        normalized.includes('invalid')

      setError(isInvalidCredentials ? 'Email o password non corretti. Riprova.' : rawMessage)
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
            <div className="mt-2 text-sm text-white/60">{confirmationSent ? 'Conferma email' : 'Accesso riservato'}</div>
          </div>

          {confirmationSent ? (
            <div className="space-y-5 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Controlla la tua email</h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  Abbiamo inviato un link di conferma a<br/>
                  <strong className="text-white/80">{email}</strong>
                </p>
              </div>
              <p className="text-xs text-white/40">
                Clicca il link nell'email per attivare il tuo account e accedere alla dashboard.
              </p>
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => { setConfirmationSent(false); setMode('login') }}
                  className="text-sm text-white/60 underline underline-offset-4 hover:text-white"
                >
                  Torna al login
                </button>
              </div>
            </div>
          ) : (
          <>
          <div className="mt-6 grid grid-cols-2 rounded-2xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                mode === 'login' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Accedi
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                mode === 'signup' ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Registrati
            </button>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/80">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@azienda.it"
                className="h-12 rounded-2xl border-white/10 bg-slate-950/40 text-white placeholder:text-white/30"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/80">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 rounded-2xl border-white/10 bg-slate-950/40 text-white placeholder:text-white/30"
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <div className="text-right">
                <a
                  href="/auth/reset-password"
                  className="text-xs text-white/60 underline underline-offset-4 hover:text-white"
                >
                  Hai dimenticato la password?
                </a>
              </div>
            </div>

            {error ? (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl mb-3">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={loading}
              className={`h-12 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 shadow-[0_18px_60px_-20px_rgba(124,58,237,0.65)] hover:shadow-[0_18px_70px_-18px_rgba(59,130,246,0.55)] transition-all duration-200 ${
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
                  {mode === 'signup' ? 'Creazione account…' : 'Accesso in corso…'}
                </span>
              ) : mode === 'signup' ? (
                'Crea Account'
              ) : (
                'Entra'
              )}
            </Button>

            <div className="text-center text-xs text-white/45">
              Proseguendo accetti i{' '}
              <a href="/terms" className="text-white/70 underline underline-offset-2 hover:text-white">termini di servizio</a>
              {' '}e la{' '}
              <a href="/privacy" className="text-white/70 underline underline-offset-2 hover:text-white">privacy policy</a>.
            </div>
          </form>
          </>
          )}
        </Card>
      </div>
    </div>
  )
}
