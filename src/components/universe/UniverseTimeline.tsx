'use client'

import type { TimelinePoint } from '@/lib/universe/types'
import { formatObservationValue, labelObservation } from '@/lib/universe/labels'

type Props = {
  points: TimelinePoint[]
  limit?: number
  compact?: boolean
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function UniverseTimeline({ points, limit = 50, compact = false }: Props) {
  const rows = points.slice(0, limit)
  if (!rows.length) {
    return <p className="text-sm text-slate-500">Nessuna osservazione temporale registrata.</p>
  }

  return (
    <ol className={compact ? 'space-y-2' : 'relative space-y-0 border-l border-slate-200 pl-4 ml-1'}>
      {rows.map((p, i) => (
        <li
          key={`${p.attribute}-${p.observed_at}-${i}`}
          className={compact ? 'rounded-lg border border-slate-100 bg-white px-3 py-2' : 'relative pb-5 last:pb-0'}
        >
          {!compact ? (
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-violet-500 shadow-sm" />
          ) : null}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-slate-900">{labelObservation(p.attribute)}</span>
            <time className="text-[11px] tabular-nums text-slate-400">{formatWhen(p.observed_at)}</time>
          </div>
          <p className="mt-0.5 text-sm text-slate-700">{formatObservationValue(p.value)}</p>
          {!compact ? (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
              {p.source} · conf. {Math.round((p.confidence ?? 1) * 100)}%
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
