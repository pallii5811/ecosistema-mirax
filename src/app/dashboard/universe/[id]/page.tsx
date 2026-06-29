'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Building2, Loader2, MapPin, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getUniverseEntity } from '@/lib/universe/client'
import type { UniverseEntityDetail } from '@/lib/universe/client'
import { UniverseEntityBadge } from '@/components/universe/UniverseEntityBadge'
import { UniverseTimeline } from '@/components/universe/UniverseTimeline'
import { UniverseRelationsList } from '@/components/universe/UniverseRelationsList'
import { UniverseEventsList } from '@/components/universe/UniverseEventsList'
import { UniverseDigitalTwinPanel } from '@/components/universe/UniverseDigitalTwinPanel'
import { formatObservationValue, labelObservation } from '@/lib/universe/labels'

type Tab = 'twin' | 'timeline' | 'relations' | 'events'

export default function UniverseEntityPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [data, setData] = useState<UniverseEntityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('twin')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setData(await getUniverseEntity(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Entità non trovata')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const latestByAttr = new Map<string, unknown>()
  if (data?.timeline) {
    for (const p of data.timeline) {
      if (!latestByAttr.has(p.attribute)) latestByAttr.set(p.attribute, p.value)
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'twin', label: 'Digital Twin' },
    { id: 'timeline', label: 'Timeline', count: data?.timeline.length },
    { id: 'relations', label: 'Relazioni', count: data?.related.length },
    { id: 'events', label: 'Eventi', count: data?.events?.length },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-slate-600">
          <Link href="/dashboard/universe">
            <ArrowLeft className="h-4 w-4" /> Grafo
          </Link>
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Aggiorna
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-24 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
          Caricamento entità…
        </div>
      ) : null}

      {error ? (
        <Card className="border-rose-200 bg-rose-50 p-6 text-center text-rose-800">{error}</Card>
      ) : null}

      {data ? (
        <>
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-6 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Building2 className="h-6 w-6 opacity-90" />
                    <h1 className="text-2xl font-bold">{data.entity.name}</h1>
                    <UniverseEntityBadge type={data.entity.entity_type} className="border-white/30 bg-white/15 text-white" />
                  </div>
                  {(data.entity.city || data.entity.country) && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-violet-100">
                      <MapPin className="h-4 w-4" />
                      {[data.entity.city, data.entity.region, data.entity.country].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-xs text-violet-200/90">{data.entity.canonical_id}</p>
                </div>
              </div>
            </div>

            {latestByAttr.size > 0 ? (
              <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
                {[...latestByAttr.entries()].slice(0, 8).map(([attr, val]) => (
                  <div key={attr} className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{labelObservation(attr)}</dt>
                    <dd className="text-sm font-semibold text-slate-900">{formatObservationValue(val)}</dd>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-b-2 border-violet-600 text-violet-700 bg-violet-50/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {typeof t.count === 'number' ? (
                  <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] tabular-nums">{t.count}</span>
                ) : null}
              </button>
            ))}
          </div>

          <Card className="p-5">
            {tab === 'twin' ? <UniverseDigitalTwinPanel entityId={id} /> : null}
            {tab === 'timeline' ? <UniverseTimeline points={data.timeline} /> : null}
            {tab === 'relations' ? <UniverseRelationsList related={data.related} /> : null}
            {tab === 'events' ? <UniverseEventsList events={data.events ?? []} /> : null}
          </Card>
        </>
      ) : null}
    </div>
  )
}
