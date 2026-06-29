'use client'

import { Loader2 } from 'lucide-react'
import { DiscoveryLeadCard } from '@/components/discovery/DiscoveryLeadCard'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

type Props = {
  query: string
  results: unknown[]
  isLoading: boolean
  isScraping?: boolean
  searchId?: string | null
  totalUnfilteredCount?: number
  missingSignals?: boolean
  hasActiveBusinessFilter?: boolean
  onClearBusinessFilters?: () => void
  signalIntent?: SignalIntentSpec | null
}

export function DiscoveryResultsGrid({
  query,
  results,
  isLoading,
  isScraping,
  searchId,
  totalUnfilteredCount,
  missingSignals = false,
  hasActiveBusinessFilter = false,
  onClearBusinessFilters,
  signalIntent = null,
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
      {missingSignals && hasActiveBusinessFilter && totalUnfilteredCount ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {signalIntent?.required_signals?.includes('hiring') ? (
            <>
              <span className="font-semibold">Verifica hiring in corso…</span>
              {' '}I {totalUnfilteredCount} lead sotto provengono dalla scansione territoriale. Cerca il badge viola{' '}
              <strong>Assumono (Indeed)</strong> — non confonderlo con audit sito (Pixel/SEO).
            </>
          ) : (
            <>
              <span className="font-semibold">Cercando segnali business...</span>
              {' '}I badge appariranno entro 2-3 minuti. I lead sono visibili senza filtro.
            </>
          )}
          {onClearBusinessFilters ? (
            <button
              type="button"
              onClick={onClearBusinessFilters}
              className="ml-2 underline font-medium text-amber-900"
            >
              Mostra tutti i lead
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-slate-600">
          {isScraping ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              Analisi in corso…
            </span>
          ) : missingSignals && hasActiveBusinessFilter && totalUnfilteredCount ? (
            `${totalUnfilteredCount} lead trovati — filtro attivo, segnali in arrivo`
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
            signalIntent={signalIntent}
          />
        ))}
      </div>
    </div>
  )
}

export default DiscoveryResultsGrid
