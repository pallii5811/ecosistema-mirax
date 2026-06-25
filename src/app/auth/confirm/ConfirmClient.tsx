'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function normalizeAuthError(message: string) {
  const m = message.toLowerCase()

  if (m.includes('expired') || m.includes('token has expired') || m.includes('otp expired')) {
    return 'Il link è scaduto. Richiedine uno nuovo.'
  }

  if (m.includes('invalid') || m.includes('token') || m.includes('otp')) {
    return 'Link non valido. Riprova o richiedi un nuovo link.'
  }

  return message
}

export default function ConfirmClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)

      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type')

      const otpType = (type ?? 'signup') as 'signup' | 'email_change' | 'magiclink' | 'recovery'

      try {
        if (!tokenHash) {
          throw new Error('Link di conferma non valido: token mancante.')
        }

        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType,
        })

        if (verifyError) throw verifyError

        router.push('/dashboard?toast=Email%20confermata!')
        router.refresh()
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Errore durante la conferma email.'
        setError(normalizeAuthError(raw))
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [router, searchParams, supabase])

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
            <div className="mt-2 text-sm text-white/60">Conferma email</div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-white/70">
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Verifica in corso…
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
              <div className="flex gap-3">
                <Button asChild variant="secondary" className="rounded-2xl">
                  <Link href="/login">Torna al login</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-xl">
                Email confermata!
              </div>
              <Button asChild className="h-12 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600">
                <Link href="/dashboard">Vai alla dashboard</Link>
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
