'use client'

import { Globe, Layers, Network } from 'lucide-react'
import { type SearchSource, SEARCH_SOURCE_META } from '@/lib/search-source'
import { cn } from '@/lib/utils'

type Props = {
  value: SearchSource
  onChange: (v: SearchSource) => void
  disabled?: boolean
  className?: string
}

const ICONS: Record<SearchSource, typeof Globe> = {
  maps: Globe,
  graph: Network,
  hybrid: Layers,
}

/** Selettore compatto — 3 pillole inline, hint solo al hover. */
export function SearchSourceToggle({ value, onChange, disabled, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 px-2 sm:px-4', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 shrink-0">
        Motore
      </span>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(SEARCH_SOURCE_META) as SearchSource[]).map((key) => {
          const meta = SEARCH_SOURCE_META[key]
          const Icon = ICONS[key]
          const active = value === key
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(key)}
              title={meta.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                active
                  ? 'border-violet-400 bg-violet-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
