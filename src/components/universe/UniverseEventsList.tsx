'use client'

import type { UniverseEvent } from '@/lib/universe/types'
import { eventTone, labelEvent } from '@/lib/universe/labels'
import { cn } from '@/lib/utils'

type Props = {
  events: UniverseEvent[]
  limit?: number
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function UniverseEventsList({ events, limit = 30 }: Props) {
  const rows = events.slice(0, limit)
  if (!rows.length) {
    return <p className="text-sm text-slate-500">Nessun evento commerciale registrato.</p>
  }

  return (
    <ul className="space-y-2">
      {rows.map((ev) => (
        <li
          key={ev.id ?? `${ev.event_type}-${ev.occurred_at}`}
          className={cn('rounded-xl border px-4 py-3', eventTone(ev.event_type))}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{labelEvent(ev.event_type)}</span>
            <time className="text-[11px] opacity-70">{formatWhen(ev.occurred_at)}</time>
          </div>
          {ev.source ? <p className="mt-1 text-xs opacity-80">Fonte: {ev.source}</p> : null}
        </li>
      ))}
    </ul>
  )
}
