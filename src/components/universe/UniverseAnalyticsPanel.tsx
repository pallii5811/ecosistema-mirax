'use client'

import { useEffect, useState } from 'react'
import { Activity, BarChart3, Loader2, MapPin, Radio } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { UniverseAnalyticsSummary } from '@/lib/universe/analytics'
import { labelEvent } from '@/lib/universe/labels'

type Props = {
  days?: number
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value.toLocaleString('it-IT')}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  )
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-700 truncate pr-2">{label}</span>
        <span className="tabular-nums text-slate-500 shrink-0">{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function UniverseAnalyticsPanel({ days = 30 }: Props) {
  const [data, setData] = useState<UniverseAnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/universe/analytics?days=${days}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => {
        if (!cancelled) setData(body.analytics)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Errore')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [days])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        Caricamento analytics…
      </div>
    )
  }

  if (error || !data) {
    return <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error ?? 'Dati non disponibili'}</Card>
  }

  const eventEntries = Object.entries(data.events_by_type).sort((a, b) => b[1] - a[1])
  const maxEvent = eventEntries[0]?.[1] ?? 0
  const sourceEntries = Object.entries(data.observations_by_source).sort((a, b) => b[1] - a[1])
  const maxSource = sourceEntries[0]?.[1] ?? 0

  return (
    <div className="space-y-6">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-600">
        <BarChart3 className="h-3.5 w-3.5" />
        Analytics grafo · ultimi {days} giorni
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aziende" value={data.companies} />
        <StatCard label="Osservazioni" value={data.observations} />
        <StatCard label="Relazioni" value={data.relationships} />
        <StatCard
          label="Eventi"
          value={data.events_total}
          sub={`${data.events_last_7d} ultimi 7g · ${data.events_unprocessed} in coda`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
            <Activity className="h-3.5 w-3.5" />
            Eventi per tipo
          </p>
          {eventEntries.length ? (
            <div className="space-y-2.5">
              {eventEntries.map(([type, count]) => (
                <BarRow
                  key={type}
                  label={labelEvent(type as Parameters<typeof labelEvent>[0])}
                  count={count}
                  max={maxEvent}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nessun evento nel periodo.</p>
          )}
        </Card>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
            <MapPin className="h-3.5 w-3.5" />
            Top città
          </p>
          {data.top_cities.length ? (
            <div className="space-y-2.5">
              {data.top_cities.map((row) => (
                <BarRow
                  key={row.city}
                  label={row.city}
                  count={row.count}
                  max={data.top_cities[0]?.count ?? 1}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Grafo senza città indicizzate.</p>
          )}
        </Card>
      </div>

      {sourceEntries.length > 0 ? (
        <Card className="p-4">
          <p className="mb-3 text-xs font-bold uppercase text-slate-500">Osservazioni per fonte</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sourceEntries.map(([source, count]) => (
              <BarRow key={source} label={source} count={count} max={maxSource} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
