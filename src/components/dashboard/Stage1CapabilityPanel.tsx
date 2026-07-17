'use client'

import { STAGE1_CAPABILITY_MATRIX, type Stage1CapabilityStatus } from '@/lib/stage1-capabilities'

const STATUS_STYLE: Record<Stage1CapabilityStatus, string> = {
  SUPPORTED: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  SUPPORTED_PARTIAL: 'border-amber-200 bg-amber-50 text-amber-950',
  BETA: 'border-slate-200 bg-slate-50 text-slate-700',
  UNAVAILABLE: 'border-rose-200 bg-rose-50 text-rose-900',
}

export function Stage1CapabilityPanel() {
  return (
    <section
      aria-label="Stato capability Stage 1"
      className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Capability Stage 1</h2>
        <p className="text-xs text-slate-500">Stati certificati — nessun padding dei risultati</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STAGE1_CAPABILITY_MATRIX.filter((item) => item.id !== 'other' || item.status !== 'SUPPORTED').map((item) => (
          <li
            key={item.id}
            className={`rounded-lg border px-3 py-2 ${STATUS_STYLE[item.status]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-[10px] font-semibold tracking-wide">{item.status}</span>
            </div>
            <p className="mt-1 text-xs leading-snug opacity-90">{item.limits}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
