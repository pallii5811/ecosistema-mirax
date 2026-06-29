'use client'

import { useEffect, useState } from 'react'
import { Database, Network } from 'lucide-react'

type Stats = {
  companies: number
  observations: number
  universe_enabled: boolean
  universe_read_enabled: boolean
}

export function UniverseGraphStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/universe/stats', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error || !stats) return null

  const empty = stats.companies === 0

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
        empty
          ? 'border-amber-200 bg-amber-50/80 text-amber-900'
          : 'border-violet-200/80 bg-violet-50/50 text-violet-950'
      }`}
    >
      <Network className="h-4 w-4 shrink-0" />
      <span>
        <strong className="tabular-nums">{stats.companies.toLocaleString('it-IT')}</strong> aziende nel grafo
        <span className="text-violet-700/80">
          {' '}
          · <strong className="tabular-nums">{stats.observations.toLocaleString('it-IT')}</strong> osservazioni
        </span>
      </span>
      {empty ? (
        <span className="text-xs text-amber-800">
          Grafo vuoto — attiva <code className="rounded bg-white/80 px-1">UNIVERSE_ENABLED=1</code> e lancia una ricerca Maps
        </span>
      ) : null}
      {!stats.universe_enabled ? (
        <span className="inline-flex items-center gap-1 text-xs text-slate-600">
          <Database className="h-3 w-3" />
          Ingest sidecar OFF
        </span>
      ) : null}
    </div>
  )
}
