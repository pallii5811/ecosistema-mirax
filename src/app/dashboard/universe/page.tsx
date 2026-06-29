'use client'

import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Activity, Network, Search, Sparkles } from 'lucide-react'
import { AgenticSearchPanel } from '@/components/universe/AgenticSearchPanel'
import { UniverseExplorerPanel } from '@/components/universe/UniverseExplorerPanel'
import { UniverseAnalyticsPanel } from '@/components/universe/UniverseAnalyticsPanel'
import { UniverseLiveEventsFeed } from '@/components/universe/UniverseLiveEventsFeed'
import { UniverseAlertsPanel } from '@/components/universe/UniverseAlertsPanel'
import { UniverseWebhookDeliveriesPanel } from '@/components/universe/UniverseWebhookDeliveriesPanel'
import { cn } from '@/lib/utils'

type Tab = 'agentic' | 'explore' | 'analytics'

function UniversePageInner() {
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q')?.trim() ?? ''
  const urlTab = searchParams.get('tab')
  const initialTab: Tab =
    urlTab === 'explore' ? 'explore' : urlTab === 'analytics' ? 'analytics' : 'agentic'
  const [tab, setTab] = useState<Tab>(initialTab)

  const setTabWithUrl = useCallback((next: Tab) => {
    setTab(next)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (next === 'agentic') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url.toString())
  }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Network className="h-7 w-7 text-violet-600" />
          Knowledge Graph
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Piattaforma dati commerciale MIRAX — ricerca in linguaggio naturale sul grafo, esplorazione manuale,
          analytics e stream eventi in tempo reale.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1">
        <button
          type="button"
          onClick={() => setTabWithUrl('agentic')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition',
            tab === 'agentic'
              ? 'bg-white text-violet-800 shadow-sm border border-violet-200/60'
              : 'text-slate-600 hover:text-slate-900',
          )}
        >
          <Sparkles className="h-4 w-4" />
          Ricerca AI
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

      {tab === 'agentic' ? (
        <AgenticSearchPanel initialQuery={urlQuery} autoRun={Boolean(urlQuery)} />
      ) : null}
      {tab === 'explore' ? <UniverseExplorerPanel /> : null}
      {tab === 'analytics' ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-4">
            <UniverseAnalyticsPanel />
          </div>
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <UniverseAlertsPanel />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <UniverseWebhookDeliveriesPanel />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <UniverseLiveEventsFeed />
            </div>
          </div>
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
