'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem('ckb_cookie_consent')
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  const accept = () => {
    localStorage.setItem('ckb_cookie_consent', 'all')
    setVisible(false)
  }

  const reject = () => {
    localStorage.setItem('ckb_cookie_consent', 'essential')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] px-4 pb-4 animate-in slide-in-from-bottom-4 duration-500"
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-black/10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900 mb-1">
              Questo sito utilizza cookie
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Utilizziamo cookie tecnici necessari e, con il tuo consenso, cookie analitici per
              migliorare la tua esperienza.{' '}
              <Link href="/cookie-policy" className="text-violet-600 hover:underline">
                Scopri di più
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={reject}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Solo necessari
            </button>
            <button
              onClick={accept}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              Accetta tutti
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
