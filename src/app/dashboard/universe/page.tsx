'use client'

import { Suspense, useCallback, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Network, Search, Sparkles, Activity } from 'lucide-react'
import { UniverseExplorerPanel } from '@/components/universe/UniverseExplorerPanel'
import { UniverseGraphCanvas } from '@/components/universe/UniverseGraphCanvas'
import { UniverseGraphStats } from '@/components/universe/UniverseGraphStats'
import { UniverseAnalyticsPanel } from '@/components/universe/UniverseAnalyticsPanel'
import { UniverseLiveEventsFeed } from '@/components/universe/UniverseLiveEventsFeed'
import { UniverseAlertsPanel } from '@/components/universe/UniverseAlertsPanel'
import { cn } from '@/lib/utils'

type Tab = 'graph' | 'explore' | 'analytics'

function UniversePageInner() {
  const searchParams = useSearchParams()
  const urlCity = searchParams.get('city')?.trim() ?? ''
  const urlName = searchParams.get('name')?.trim() ?? searchParams.get('q')?.trim() ?? ''
  const urlEntity = searchParams.get('entity')?.trim() ?? searchParams.get('entity_id')?.trim() ?? ''
  const urlTab = searchParams.get('tab')
  const initialTab: Tab = urlTab === 'explore' ? 'explore' : urlTab === 'analytics' ? 'analytics' : 'graph'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [cityFilter, setCityFilter] = useState(urlCity)
  const [nameFilter, setNameFilter] = useState(urlName)

  const setTabWithUrl = useCallback((next: Tab) => {
    setTab(next)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next === 'graph') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url.toString())
  }, [])

  const syncFiltersToUrl = useCallback((city: string, name: string) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (city.trim()) url.searchParams.set('city', city.trim())
    else url.searchParams.delete('city')
    if (name.trim()) url.searchParams.set('name', name.trim())
    else {
      url.searchParams.delete('name')
      url.searchParams.delete('q')
    }
    window.history.replaceState(null, '', url.toString())
  }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Network className="h-7 w-7 text-violet-600" />
            Knowledge Graph
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Scopri connessioni tra aziende, tecnologie, assunzioni e opportunità già raccolte da MIRAX.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-800 transition hover:border-violet-400 hover:bg-violet-100"
        >
          <Sparkles className="h-4 w-4" />
          Cerca dalla dashboard
        </Link>
      </div>

      <UniverseGraphStats />

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1">
        <button
          type="button"
          onClick={() => setTabWithUrl('graph')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',
            tab === 'graph'
              ? 'bg-white text-violet-800 shadow-sm border border-violet-200/60'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Network className="h-4 w-4" />
          Grafo visuale
        </button>
        <button
          type="button"
          onClick={() => setTabWithUrl('explore')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',
            tab === 'explore'
              ? 'bg-white text-violet-800 shadow-sm border border-violet-200/60'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Search className="h-4 w-4" />
          Esplora
        </button>
        <button
          type="button"
          onClick={() => setTabWithUrl('analytics')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',
            tab === 'analytics'
              ? 'bg-white text-violet-800 shadow-sm border border-violet-200/60'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Activity className="h-4 w-4" />
          Live & Analytics
        </button>
      </div>

      {tab === 'graph' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Città</span>
              <input
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="es. Taormina"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-semibold text-slate-700">Parola chiave (opzionale)</span>
              <input
                type="text"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="es. edil"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <button
              type="button"
              onClick={() => syncFiltersToUrl(cityFilter, nameFilter)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Applica filtri
            </button>
          </div>
          <UniverseGraphCanvas
            city={cityFilter || urlCity || undefined}
            name={nameFilter || undefined}
            entityId={urlEntity || undefined}
          />
        </div>
      ) : null}
      {tab === 'explore' ? <UniverseExplorerPanel /> : null}
      {tab === 'analytics' ? (
        <div className="space-y-6">
          <UniverseLiveEventsFeed />
          <UniverseAnalyticsPanel />
          <UniverseAlertsPanel />
        </div>
      ) : null}
    </div>
  )
}

export default function UniversePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-500">Caricamento Knowledge Graph…</div>
      }
    >
      <UniversePageInner />
    </Suspense>
  )
}
