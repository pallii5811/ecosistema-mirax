'use client'

import SniperArea from '@/components/SniperArea'
import ResultsTable from '@/components/ResultsTable'
import { SaveAllListModal } from '@/components/SaveAllListModal'
import { useToast } from '@/components/ToastProvider'
import { Button } from '@/components/ui/button'
import { MiraxLogo } from '@/components/MiraxLogo'
import { useDashboardState } from '@/components/dashboard/hooks/useDashboardState'
import { useCredits } from '@/components/dashboard/hooks/useCredits'
import { PartialSearchBanner } from '@/components/dashboard/PartialSearchBanner'
import { useSearchJob } from '@/components/dashboard/hooks/useSearchJob'
import { useSignalIntentEnrich } from '@/components/dashboard/hooks/useSignalIntentEnrich'

export default function DashboardShell() {
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast()

  const dashboard = useDashboardState()
  const creditsApi = useCredits()
  const searchJob = useSearchJob(dashboard, creditsApi, { toastError, toastInfo, toastSuccess })

  const {
    query,
    setQuery,
    maxLeads,
    setMaxLeads,
    error,
    results,
    currentSearchId,
    activeFilters,
    isSaveAllOpen,
    setIsSaveAllOpen,
    hasSearched,
    signalIntent,
    aiDebug,
  } = dashboard

  const { credits, clampMaxLeads } = creditsApi
  const { isLoading, isScraping, loadingMessage, streamingProgress, processSemanticSearch } = searchJob

  useSignalIntentEnrich(results, query, signalIntent, dashboard.setResults)

  const showPartialResults = isScraping && (results.length > 0 || streamingProgress?.found)
  const showBlockingLoader = (isLoading || isScraping) && !showPartialResults

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Trova lead pronti</h1>
        <p className="mt-1 text-sm text-slate-600">Scrivi in linguaggio naturale e lascia che MiraX trovi le aziende giuste.</p>
      </div>

      <SniperArea
        query={query}
        onQueryChange={setQuery}
        onStart={processSemanticSearch}
        isLoading={isLoading}
        error={error}
        aiDebug={aiDebug}
        maxLeads={clampMaxLeads(maxLeads)}
        onMaxLeadsChange={(v) => setMaxLeads(clampMaxLeads(v))}
        credits={credits}
      />

      {showBlockingLoader && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-violet-100 bg-violet-50/50 py-12">
          <div className="relative">
            <div className="animate-spin rounded-full border-4 border-violet-200 border-t-violet-600 p-8">
              <MiraxLogo size={48} variant="dark" showWordmark={false} />
            </div>
          </div>
          <p className="mt-4 text-base font-semibold text-violet-800">{loadingMessage}</p>
          <p className="mt-1 text-sm text-violet-600">
            {isScraping ? 'Discovery live — i lead compaiono man mano.' : 'Interrogo il Knowledge Graph MiraX.'}
          </p>
        </div>
      )}

      {showPartialResults && streamingProgress && (
        <PartialSearchBanner
          found={Math.max(streamingProgress.found, results.length)}
          target={streamingProgress.target}
          message={
            isScraping
              ? 'Discovery in corso — i lead restano in lista mentre arrivano audit e contatti.'
              : undefined
          }
        />
      )}

      {showPartialResults && isScraping && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/80 px-3 py-2 text-sm text-violet-700">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-500" />
          {loadingMessage || "L'Agente AI sta ancora lavorando…"}
        </div>
      )}

      {results.length > 0 && !isLoading && (
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            className="gap-2 rounded-full border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={() => setIsSaveAllOpen(true)}
          >
            Salva tutta la lista
          </Button>
        </div>
      )}

      {hasSearched && (results.length > 0 || isLoading || isScraping) && (
        <ResultsTable
          query={query}
          results={results}
          isLoading={isLoading}
          isScraping={isScraping}
          searchId={currentSearchId}
          filters={activeFilters}
          aiDebug={aiDebug}
          signalIntent={signalIntent}
          hasActiveBusinessFilter={Boolean(signalIntent?.required_signals?.length)}
        />
      )}

      {results.length > 0 && !isLoading && (
        <div className="flex justify-center">
          <Button
            className="gap-2 rounded-full bg-violet-600 px-6 text-white hover:bg-violet-500"
            onClick={() => setIsSaveAllOpen(true)}
          >
            Salva tutta la lista
          </Button>
        </div>
      )}

      <SaveAllListModal
        open={isSaveAllOpen}
        onClose={() => setIsSaveAllOpen(false)}
        leads={results}
        defaultName={query || 'Nuova lista'}
      />
    </div>
  )
}
