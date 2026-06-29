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

export function SearchSourceToggle({ value, onChange, disabled, className }: Props) {
  return (
    <div className={cn('px-2 sm:px-4', className)}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Dove cercare
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition',
                active
                  ? 'border-violet-400 bg-violet-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-violet-200',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-violet-600' : 'text-slate-400')} />
              <span>
                <span className={cn('block text-sm font-semibold', active ? 'text-violet-900' : 'text-slate-800')}>
                  {meta.label}
                </span>
                <span className="block text-[11px] text-slate-500 leading-snug">{meta.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
