'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, Network } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { resolveUniverseEntityByDomain } from '@/lib/universe/client'
import type { UniverseResolveResult } from '@/lib/universe/client'
import { UniverseEntityBadge } from './UniverseEntityBadge'
import { UniverseTimeline } from './UniverseTimeline'
import { UniverseRelationsList } from './UniverseRelationsList'
import { UniverseEmptyState } from './UniverseEmptyState'

type Props = {
  website?: string | null
  leadName?: string | null
}

export function UniverseLeadPanel({ website, leadName }: Props) {
  const [data, setData] = useState<UniverseResolveResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!website?.trim()) return
    setLoading(true)
    setError(null)
    setMissing(false)
    try {
      const result = await resolveUniverseEntityByDomain(website)
      if (!result) {
        setMissing(true)
        setData(null)
        return
      }
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore grafo')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [website])

  useEffect(() => {
    load()
  }, [load])

  if (!website?.trim()) return null

  return (
    <Card className="overflow-hidden border-violet-200/80 bg-gradient-to-br from-violet-50/50 to-white">
      <div className="border-b border-violet-100/80 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Network className="h-5 w-5 text-violet-600" />
              Knowledge Graph
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Profilo commerciale unificato{leadName ? ` · ${leadName}` : ''} — osservazioni, relazioni ed eventi.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Aggiorna'}
          </Button>
        </div>
      </div>

      <div className="p-5">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
            Collegamento al grafo…
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : null}

        {missing && !loading ? <UniverseEmptyState variant="not-found" onRetry={load} /> : null}

        {data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-slate-900">{data.entity.name}</span>
                  <UniverseEntityBadge type={data.entity.entity_type} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{data.entity.canonical_id}</p>
              </div>
              <Button asChild size="sm" variant="default" className="gap-1.5 bg-violet-600 hover:bg-violet-700">
                <Link href={`/dashboard/universe/${data.entity.id}`}>
                  Apri grafo <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>

            {data.timeline.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Ultime osservazioni</h3>
                <UniverseTimeline points={data.timeline} limit={4} compact />
              </div>
            ) : null}

            {data.related.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Relazioni</h3>
                <UniverseRelationsList related={data.related} limit={4} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
