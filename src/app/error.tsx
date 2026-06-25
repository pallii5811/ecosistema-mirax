'use client'

import { useEffect } from 'react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-red-100 border border-red-200 mb-6">
          <span className="text-3xl">⚠️</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          Qualcosa è andato storto
        </h1>
        <p className="text-sm text-slate-500 mb-8 leading-relaxed">
          Si è verificato un errore imprevisto. Il nostro team è stato notificato.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Riprova
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Torna alla Home
          </a>
        </div>
      </div>
    </div>
  )
}
