'use client'

import { Loader2 } from 'lucide-react'
import { DiscoveryLeadCard } from '@/components/discovery/DiscoveryLeadCard'

type Props = {
  query: string
  results: unknown[]
  isLoading: boolean
  isScraping?: boolean
  searchId?: string | null
  totalUnfilteredCount?: number
}

export function DiscoveryResultsGrid({
  query,
  results,
  isLoading,
  isScraping,
  searchId,
  totalUnfilteredCount,
}: Props) {
  if (isLoading && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        <p className="text-sm font-medium">Sto cercando clienti per te…</p>
      </div>
    )
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm text-slate-600">
          Nessun risultato con contatto disponibile. Prova un&apos;altra città o settore.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-slate-600">
          {isScraping ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              Analisi in corso…
            </span>
          ) : totalUnfilteredCount && totalUnfilteredCount !== results.length ? (
            `${results.length} di ${totalUnfilteredCount} lead`
          ) : (
            `${results.length} opportunità`
          )}
          {query ? ` · ${query}` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((lead, idx) => (
          <DiscoveryLeadCard
            key={idx}
            lead={lead && typeof lead === 'object' ? (lead as Record<string, unknown>) : {}}
            searchId={searchId}
          />
        ))}
      </div>
    </div>
  )
}

export default DiscoveryResultsGrid
