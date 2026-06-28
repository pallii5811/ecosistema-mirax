'use client'

import type { MiraxUiMode } from '@/lib/ui-mode'
import { UI_MODE_LABELS } from '@/lib/ui-mode'
import { Sparkles, Wrench } from 'lucide-react'

type Props = {
  mode: MiraxUiMode
  onChange: (mode: MiraxUiMode) => void
  compact?: boolean
  className?: string
}

export function UiModeToggle({ mode, onChange, compact = false, className = '' }: Props) {
  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-0.5 ${className}`}
      role="group"
      aria-label="Modalità interfaccia"
    >
      <button
        type="button"
        onClick={() => onChange('expert')}
        title={UI_MODE_LABELS.expert.description}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          mode === 'expert' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <Wrench className="h-3 w-3" />
        {compact ? 'Expert' : UI_MODE_LABELS.expert.short}
      </button>
      <button
        type="button"
        onClick={() => onChange('discovery')}
        title={UI_MODE_LABELS.discovery.description}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          mode === 'discovery' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <Sparkles className="h-3 w-3" />
        {compact ? 'Discovery' : UI_MODE_LABELS.discovery.short}
      </button>
    </div>
  )
}

export default UiModeToggle
