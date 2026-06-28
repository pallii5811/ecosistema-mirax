'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Wrench, X } from 'lucide-react'
import type { MiraxUiMode } from '@/lib/ui-mode'
import { markFirstRunDone, UI_MODE_LABELS, writeUiMode } from '@/lib/ui-mode'

type Props = {
  onSelect: (mode: MiraxUiMode) => void
}

export function FirstRunModal({ onSelect }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const done = localStorage.getItem('mirax_first_run_done')
      const mode = localStorage.getItem('mirax_ui_mode')
      if (!done && !mode) {
        const t = setTimeout(() => setVisible(true), 600)
        return () => clearTimeout(t)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const choose = (mode: MiraxUiMode) => {
    writeUiMode(mode)
    markFirstRunDone()
    onSelect(mode)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => choose('expert')} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => choose('expert')}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
          aria-label="Chiudi"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pt-8">
          <h2 className="text-xl font-bold text-slate-900 mb-1">Come preferisci lavorare?</h2>
          <p className="text-sm text-slate-500 mb-6">Puoi cambiare in qualsiasi momento dall&apos;header.</p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => choose('discovery')}
              className="w-full text-left rounded-xl border-2 border-violet-200 bg-violet-50/50 hover:bg-violet-50 p-4 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{UI_MODE_LABELS.discovery.label}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{UI_MODE_LABELS.discovery.description}</div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => choose('expert')}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-slate-300 bg-white p-4 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Wrench className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{UI_MODE_LABELS.expert.label}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{UI_MODE_LABELS.expert.description}</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FirstRunModal
