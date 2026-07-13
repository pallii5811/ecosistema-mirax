import { Suspense } from 'react'
import ConfirmClient from './ConfirmClient'
import { Card } from '@/components/ui/card'

// OTP confirmation is request-specific and must never be emitted as a reusable
// static artifact. This also gives Vercel an explicit server function boundary.
export const dynamic = 'force-dynamic'

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
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
            </Card>
          </div>
        </div>
      }
    >
      <ConfirmClient />
    </Suspense>
  )
}
