'use client'

import { useEffect, useRef, useState } from 'react'
import { useDashboard } from '@/components/DashboardContext'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

/**
 * Stato UI della dashboard: query, filtri, risultati visualizzati, modalità expert.
 * Nessuna logica di job/scrape — solo stato presentazionale + filtri attivi.
 */
export function useDashboardState() {
  const { uiMode, setUiMode } = useDashboard()

  const [query, setQuery] = useState('')
  const [maxLeads, setMaxLeads] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<unknown[]>([])
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<Record<string, unknown> | null>(null)
  const [isSaveAllOpen, setIsSaveAllOpen] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [signalIntent, setSignalIntent] = useState<SignalIntentSpec | null>(null)
  const [aiDebug, setAiDebug] = useState<unknown>(null)
  const [selectedLeadKeys, setSelectedLeadKeys] = useState<Set<string>>(new Set())

  const signalIntentRef = useRef<SignalIntentSpec | null>(null)
  const resultsArrRef = useRef<unknown[]>([])
  const resultsCountRef = useRef(0)

  useEffect(() => {
    signalIntentRef.current = signalIntent
  }, [signalIntent])

  useEffect(() => {
    resultsArrRef.current = results
  }, [results])

  const resetSearchPresentation = () => {
    setResults([])
    resultsArrRef.current = []
    resultsCountRef.current = 0
    setActiveFilters(null)
    setAiDebug(null)
    setCurrentSearchId(null)
    setIsSaveAllOpen(false)
    setSelectedLeadKeys(new Set())
  }

  const toggleLeadSelection = (key: string) => {
    setSelectedLeadKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clearLeadSelection = () => setSelectedLeadKeys(new Set())

  return {
    uiMode,
    setUiMode,
    query,
    setQuery,
    maxLeads,
    setMaxLeads,
    error,
    setError,
    results,
    setResults,
    currentSearchId,
    setCurrentSearchId,
    activeFilters,
    setActiveFilters,
    isSaveAllOpen,
    setIsSaveAllOpen,
    hasSearched,
    setHasSearched,
    signalIntent,
    setSignalIntent,
    aiDebug,
    setAiDebug,
    selectedLeadKeys,
    setSelectedLeadKeys,
    toggleLeadSelection,
    clearLeadSelection,
    signalIntentRef,
    resultsArrRef,
    resultsCountRef,
    resetSearchPresentation,
  }
}

export type DashboardState = ReturnType<typeof useDashboardState>
