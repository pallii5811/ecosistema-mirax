'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Radio } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import {
  isUniverseRealtimeEnabled,
  prependUniverseEvent,
  subscribeToUniverseEvents,
  type UniverseRealtimeEvent,
} from '@/lib/realtime/universe-event-stream'
import { eventTone, labelEvent } from '@/lib/universe/labels'
import { cn } from '@/lib/utils'

type Props = {
  entityId?: string
  limit?: number
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function UniverseLiveEventsFeed({ entityId, limit = 25 }: Props) {
  const [events, setEvents] = useState<UniverseRealtimeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: String(limit) })
      if (entityId) qs.set('entity_id', entityId)
      const res = await fetch(`/api/universe/events/recent?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setEvents(body.events ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore feed')
    } finally {
      setLoading(false)
    }
  }, [entityId, limit])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    if (!isUniverseRealtimeEnabled()) return

    const supabase = createClient()
    const unsub = subscribeToUniverseEvents(
      supabase,
      (ev) => {
        setLive(true)
        setEvents((prev) => prependUniverseEvent(prev, ev, limit))
      },
      { entityId },
    )

    return unsub
  }, [entityId, limit])

  if (loading && !events.length) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        Caricamento eventi…
      </div>
    )
  }

  if (error && !events.length) {
    return <p className="text-sm text-rose-700">{error}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-600">
          <Radio className={cn('h-3.5 w-3.5', live && 'text-emerald-600 animate-pulse')} />
          Live event stream
          {live ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              LIVE
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => void loadInitial()}
          className="text-[11px] text-violet-600 hover:underline"
        >
          Aggiorna
        </button>
      </div>

      {!events.length ? (
        <p className="text-sm text-slate-500">
          Nessun evento ancora. Attiva <code className="text-xs bg-slate-100 px-1 rounded">UNIVERSE_ENABLED=1</code> e
          il cron website diff per popolare lo stream.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {events.map((ev) => (
            <li
              key={ev.id}
              className={cn('rounded-xl border px-3 py-2.5 text-sm', eventTone(ev.event_type))}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{labelEvent(ev.event_type)}</span>
                <time className="text-[10px] opacity-70">{formatWhen(ev.occurred_at)}</time>
              </div>
              {ev.entity_name && ev.entity_id ? (
                <Link
                  href={`/dashboard/universe/${ev.entity_id}`}
                  className="mt-1 block text-xs font-medium text-violet-800 hover:underline"
                >
                  {ev.entity_name}
                </Link>
              ) : null}
              {ev.source ? <p className="mt-0.5 text-[10px] opacity-75">Fonte: {ev.source}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
