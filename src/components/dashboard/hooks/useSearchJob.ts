'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { unifiedSearchAction } from '@/app/dashboard/unified-search-action'
import { clampSearchMaxLeads } from '@/lib/search-job-payload'
import { useSearchRealtime, type SearchRealtimeUpdate } from '@/lib/realtime/search-stream'
import { filterLeadsDeterministic } from '@/lib/lead-relevance'
import { parseSignalIntentOffline } from '@/lib/signal-intent/parse-semantic'
import {
  countLeadsMatchingSignalIntent,
  isSignalFocusedIntent,
  resultsSummaryForIntent,
  shouldShowLeadForSignalIntent,
} from '@/lib/signal-intent/lead-visibility'
import { deduplicateResults, hasLeadContactOrWebsite, normalizeLeadFields } from '@/components/dashboard/lead-utils'
import { isAuditPendingLead } from '@/lib/lead-audit-status'
import { hasLeadContact } from '@/lib/search-contact-quality'
import {
  applyStreamingDisplay,
  normalizeStreamingBatch,
} from '@/lib/search-streaming/display-results'
import { useResumeAudits } from '@/components/dashboard/hooks/useResumeAudits'
import type { DashboardState } from '@/components/dashboard/hooks/useDashboardState'
import type { useCredits } from '@/components/dashboard/hooks/useCredits'

type CreditsApi = ReturnType<typeof useCredits>

type ToastApi = {
  toastError: (message: string, title?: string) => void
  toastInfo: (message: string, title?: string) => void
  toastSuccess: (message: string, title?: string) => void
}

export function useSearchJob(
  dashboard: DashboardState,
  creditsApi: CreditsApi,
  toasts: ToastApi,
) {
  const { toastError, toastInfo, toastSuccess } = toasts
  const { credits, creditsRef, deductCredits } = creditsApi

  const {
    query,
    maxLeads,
    activeFilters,
    setError,
    setResults,
    setCurrentSearchId,
    setActiveFilters,
    setHasSearched,
    setSignalIntent,
    setAiDebug,
    signalIntentRef,
    resultsArrRef,
    resultsCountRef,
    resetSearchPresentation,
  } = dashboard

  const [isLoading, setIsLoading] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState<string>('')
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [streamingProgress, setStreamingProgress] = useState<{ found: number; target: number } | null>(null)

  const activeSearchQueryRef = useRef('')
  const isScrapingRef = useRef(false)
  const agenticSearchRef = useRef(false)
  const queryRef = useRef('')
  const completionMessageRef = useRef<string | null>(null)
  const activeJobIdRef = useRef<string | null>(null)
  const activeFiltersRef = useRef(activeFilters)
  const applyInFlightRef = useRef(false)

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    activeFiltersRef.current = activeFilters
  }, [activeFilters])

  useEffect(() => {
    isScrapingRef.current = isScraping
  }, [isScraping])

  const commitDisplay = useCallback(
    (display: Record<string, unknown>[]) => {
      resultsArrRef.current = display
      resultsCountRef.current = display.length
      setResults(display)
    },
    [resultsArrRef, resultsCountRef, setResults],
  )

  const batchOpts = useCallback(
    (scraping: boolean) => ({
      query: activeSearchQueryRef.current,
      maxLeads,
      credits: creditsRef.current,
      activeFilters: activeFiltersRef.current,
      scraping,
    }),
    [maxLeads, creditsRef],
  )

  /** Ricerca istantanea (graph/completed) — filtri completi. */
  const applyInstantLeads = useCallback(
    async (raw: unknown[], finalize: boolean) => {
      const contactGate = (lead: unknown) =>
        hasLeadContact(lead) || hasLeadContactOrWebsite(lead) || isAuditPendingLead(lead)

      let filtered = filterLeadsDeterministic(
        (deduplicateResults(Array.isArray(raw) ? raw.map(normalizeLeadFields) : []) as Record<string, unknown>[]).filter(
          contactGate,
        ),
        activeSearchQueryRef.current,
      ) as Record<string, unknown>[]

      const intent = signalIntentRef.current
      if (intent?.required_signals?.length) {
        filtered = filtered.filter((lead) =>
          shouldShowLeadForSignalIntent(lead, intent, { finalize, scraping: false }),
        )
      }

      const cap = clampSearchMaxLeads(maxLeads, creditsRef.current)
      const display = filtered.slice(0, cap)
      const newCount = Math.max(0, display.length - resultsCountRef.current)
      if (newCount > 0) await deductCredits(newCount)
      commitDisplay(display)

      if (finalize) {
        setIsLoading(false)
        setIsScraping(false)
        if (display.length > 0) {
          toastSuccess(`Trovati ${display.length} risultati.`, 'Ricerca completata')
        }
      }
      return display
    },
    [maxLeads, deductCredits, commitDisplay, toastSuccess, signalIntentRef, resultsCountRef, creditsRef],
  )

  /** Port legacy: aggiorna SOLO se il batch ha lead; totale non scende mai. */
  const applyStreamingUpdate = useCallback(
    async (raw: unknown[], status: string) => {
      if (!activeJobIdRef.current) return

      const finalized = status === 'completed' || status === 'error' || status === 'cancelled'
      const scraping = isScrapingRef.current && !finalized

      if (!scraping && !finalized) return

      const incoming = normalizeStreamingBatch(raw, batchOpts(scraping || !finalized))
      const current = (resultsArrRef.current || []) as Record<string, unknown>[]

      // Legacy: durante streaming, ignora batch vuoti
      if (!finalized && incoming.length === 0) return

      const { display, newCount } = applyStreamingDisplay(current, incoming, {
        ...batchOpts(scraping || !finalized),
        allowShrink: false,
      })

      if (!finalized && display.length === current.length && incoming.length === 0) return

      if (newCount > 0) await deductCredits(newCount)
      commitDisplay(display)

      if (!finalized) {
        const target = clampSearchMaxLeads(maxLeads, creditsRef.current)
        setStreamingProgress({
          found: Math.max(display.length, resultsCountRef.current),
          target,
        })
      }

      if (finalized) {
        setIsLoading(false)
        setIsScraping(false)
        isScrapingRef.current = false
        const exhaustionMsg = completionMessageRef.current
        if (display.length > 0) {
          const intentFinal = signalIntentRef.current
          if (exhaustionMsg) {
            toastInfo(exhaustionMsg, 'Ricerca completata')
          } else if (isSignalFocusedIntent(intentFinal)) {
            const matched = countLeadsMatchingSignalIntent(display, intentFinal)
            toastSuccess(resultsSummaryForIntent(display.length, matched, intentFinal), 'Ricerca completata')
          } else {
            toastSuccess(`Trovati ${display.length} risultati.`, 'Ricerca completata')
          }
        } else {
          toastInfo(exhaustionMsg || 'Nessun risultato per questa ricerca.', exhaustionMsg ? 'Ricerca completata' : 'Ricerca')
        }
        completionMessageRef.current = null
      }
    },
    [
      batchOpts,
      commitDisplay,
      deductCredits,
      maxLeads,
      creditsRef,
      resultsArrRef,
      resultsCountRef,
      signalIntentRef,
      toastInfo,
      toastSuccess,
    ],
  )

  const handleRealtimeUpdate = useCallback(
    async (update: SearchRealtimeUpdate) => {
      if (!activeJobIdRef.current) return
      if (applyInFlightRef.current) return

      const status = update.status
      const parsed = Array.isArray(update.results) ? update.results : []

      if (update.user_message) completionMessageRef.current = update.user_message

      if (status === 'running' || status === 'processing') {
        setLoadingMessage(
          agenticSearchRef.current
            ? "L'Agente AI sta navigando il web…"
            : 'Scraping Maps e audit siti in tempo reale…',
        )
      }

      if (status === 'timeout') {
        applyInFlightRef.current = true
        try {
          await applyStreamingUpdate(parsed, 'completed')
        } finally {
          applyInFlightRef.current = false
        }
        activeJobIdRef.current = null
        setPendingJobId(null)
        setStreamingProgress(null)
        return
      }

      if (status === 'error' || status === 'cancelled') {
        applyInFlightRef.current = true
        try {
          await applyStreamingUpdate(parsed, status)
        } finally {
          applyInFlightRef.current = false
        }
        activeJobIdRef.current = null
        setPendingJobId(null)
        setStreamingProgress(null)
        if (resultsCountRef.current === 0) {
          setError('La ricerca si è conclusa con un errore.')
        } else {
          toastError('Errore ricerca — i risultati già mostrati restano in lista.', 'Errore')
        }
        return
      }

      applyInFlightRef.current = true
      try {
        await applyStreamingUpdate(parsed, status)
      } finally {
        applyInFlightRef.current = false
      }

      if (status === 'completed') {
        activeJobIdRef.current = null
        setPendingJobId(null)
        setStreamingProgress(null)
      }
    },
    [applyStreamingUpdate, toastError, resultsCountRef, setError],
  )

  useSearchRealtime(pendingJobId, {
    onUpdate: handleRealtimeUpdate,
    onDone: handleRealtimeUpdate,
    onError: handleRealtimeUpdate,
    onTimeout: (u) => void handleRealtimeUpdate({ ...u, status: 'timeout' }),
  })

  useResumeAudits({
    jobId: pendingJobId,
    isActive: isScraping || Boolean(pendingJobId),
    getLeads: () => resultsArrRef.current,
    onLeadsUpdate: (leads) => {
      void applyStreamingUpdate(leads, 'running')
    },
  })

  const processSemanticSearch = useCallback(
    async (overrideQuery?: string) => {
      const q = String(overrideQuery ?? queryRef.current ?? '').trim()
      if (!q) {
        toastError('Scrivi una richiesta per avviare la ricerca.', 'Query mancante')
        return
      }
      if (credits <= 0) {
        toastError('Crediti esauriti.', 'Crediti')
        return
      }

      setError(null)
      activeJobIdRef.current = null
      resetSearchPresentation()
      setPendingJobId(null)
      setStreamingProgress(null)
      setHasSearched(true)
      activeSearchQueryRef.current = q
      queryRef.current = q
      agenticSearchRef.current = false
      completionMessageRef.current = null

      const parsedIntent = parseSignalIntentOffline(q)
      setSignalIntent(parsedIntent)
      signalIntentRef.current = parsedIntent
      setLoadingMessage('Analisi semantica della richiesta…')

      const effectiveMax = clampSearchMaxLeads(maxLeads, credits)
      setIsLoading(true)
      setIsScraping(false)
      isScrapingRef.current = false

      try {
        const response = await unifiedSearchAction(q, { maxLeads: effectiveMax })
        const status = (response as Record<string, unknown>)?.status
        const jobId = (response as Record<string, unknown>)?.jobId
        const sid = (response as Record<string, unknown>)?.searchId ?? jobId ?? null
        const filters = (response as Record<string, unknown>)?.filters
        const ai_debug = (response as Record<string, unknown>)?.ai_debug

        const searchStrategy = String((ai_debug as Record<string, unknown>)?.search_strategy ?? '')
        const isAgentic =
          searchStrategy === 'organic_web_search' ||
          String((ai_debug as Record<string, unknown>)?.source ?? '').includes('agentic')
        const isMapsDiscovery =
          searchStrategy === 'maps' ||
          searchStrategy === 'hybrid' ||
          String((ai_debug as Record<string, unknown>)?.source ?? '').includes('maps')
        agenticSearchRef.current = isAgentic && !isMapsDiscovery

        if (status === 'pending' && jobId) {
          setIsLoading(false)
          setIsScraping(true)
          isScrapingRef.current = true
          setLoadingMessage(
            isAgentic && !isMapsDiscovery
              ? "Avvio Agente AI — ricerca B2B sul web…"
              : 'Avvio discovery Maps — lead e audit in arrivo…',
          )
          setStreamingProgress({ found: 0, target: effectiveMax })
          activeJobIdRef.current = String(jobId)
          setPendingJobId(String(jobId))
          setCurrentSearchId(sid ? String(sid) : null)
          setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)
          setAiDebug(ai_debug ?? null)
          toastInfo('Discovery avviata — i lead restano in lista mentre arrivano.', 'Ricerca')
          return
        }

        setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)
        setAiDebug(ai_debug ?? null)
        setCurrentSearchId(sid ? String(sid) : null)
        const raw = Array.isArray((response as { results?: unknown[] })?.results)
          ? (response as { results: unknown[] }).results
          : []
        await applyInstantLeads(raw, true)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Errore ricerca'
        setError(message)
        toastError(message, 'Errore')
        setIsLoading(false)
        setIsScraping(false)
      }
    },
    [
      maxLeads,
      credits,
      applyInstantLeads,
      toastError,
      toastInfo,
      resetSearchPresentation,
      setError,
      setHasSearched,
      setSignalIntent,
      signalIntentRef,
      setCurrentSearchId,
      setActiveFilters,
      setAiDebug,
    ],
  )

  return {
    isLoading,
    isScraping,
    loadingMessage,
    pendingJobId,
    streamingProgress,
    processSemanticSearch,
  }
}
