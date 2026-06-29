'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Download, Loader2, Search, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { runAgenticUniverseSearch, type AgenticSearchResult } from '@/lib/universe/client'
import {
  AGENTIC_EXAMPLE_QUERIES,
  AGENTIC_LOADING_COPY,
  agenticResultsToCsv,
  type AgenticLoadingPhase,
} from '@/lib/universe/agentic-ui'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type { UniverseQuery } from '@/lib/universe/query-builder'
import { AgenticIntentBreakdown } from './AgenticIntentBreakdown'
import { AgenticQueryPlan } from './AgenticQueryPlan'
import { AgenticResultsTable } from './AgenticResultsTable'
import { AgenticResultsResponsive } from './AgenticResultsCards'
import { UniverseGraphStats } from './UniverseGraphStats'

const STORAGE_KEY = 'mirax_agentic_last_query'

type SearchState = {
  result: AgenticSearchResult | null
  error: string | null
  hasSearched: boolean
}

type Props = {
  /** Prefill da URL ?q= e auto-run al mount */
  initialQuery?: string
  autoRun?: boolean
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function AgenticSearchPanel({ initialQuery = '', autoRun = false }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [cityOverride, setCityOverride] = useState('')
  const [limit, setLimit] = useState(50)
  const [phase, setPhase] = useState<AgenticLoadingPhase>('idle')
  const searchingRef = useRef(false)
  const autoRanRef = useRef(false)
  const [state, setState] = useState<SearchState>({ result: null, error: null, hasSearched: false })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery)
      return
    }
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) setQuery(saved)
    } catch {
      /* ignore */
    }
  }, [initialQuery])

  const clearPhaseTimer = () => {
    if (phaseTimer.current) {
      clearTimeout(phaseTimer.current)
      phaseTimer.current = null
    }
  }

  const syncUrl = useCallback((q: string) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (q.trim()) url.searchParams.set('q', q.trim())
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', url.toString())
  }, [])

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed || searchingRef.current) return
      searchingRef.current = true
      setQuery(trimmed)

      try {
        sessionStorage.setItem(STORAGE_KEY, trimmed)
      } catch {
        /* ignore */
      }
      syncUrl(trimmed)

      setState({ result: null, error: null, hasSearched: true })
      setPhase('parsing')
      clearPhaseTimer()
      phaseTimer.current = setTimeout(() => setPhase('querying'), 700)

      try {
        const result = await runAgenticUniverseSearch({
          user_query: trimmed,
          city: cityOverride.trim() || undefined,
          limit,
        })
        setPhase('enriching')
        await new Promise((r) => setTimeout(r, 350))
        setState({ result, error: null, hasSearched: true })
      } catch (e) {
        setState({
          result: null,
          error: e instanceof Error ? e.message : 'Errore durante la ricerca',
          hasSearched: true,
        })
      } finally {
        clearPhaseTimer()
        searchingRef.current = false
        setPhase('idle')
      }
    },
    [cityOverride, limit, syncUrl],
  )

  useEffect(() => () => clearPhaseTimer(), [])

  useEffect(() => {
    if (!autoRun || autoRanRef.current) return
    const q = (initialQuery || query).trim()
    if (!q) return
    autoRanRef.current = true
    void runSearch(q)
  }, [autoRun, initialQuery, query, runSearch])

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    void runSearch(query)
  }

  const loading = phase !== 'idle'
  const result = state.result
  const signalIntent = result?.signal_intent as SignalIntentSpec | undefined
  const universeQuery = result?.universe_query as UniverseQuery | undefined

  const exportCsv = () => {
    if (!result?.results.length) return
    const slug = (result.user_query ?? 'risultati').slice(0, 40).replace(/[^\w\s-]/g, '').trim() || 'risultati'
    downloadCsv(`mirax-grafo-${slug}.csv`, agenticResultsToCsv(result.results))
  }

  return (
    <div className="space-y-6">
      <UniverseGraphStats />

      <div className="relative">
        <div className="pointer-events-none absolute -inset-3 rounded-[28px] bg-gradient-to-r from-violet-500/20 via-indigo-400/15 to-purple-500/20 blur-xl" />
        <Card className="relative overflow-hidden border-violet-200/70 shadow-lg shadow-violet-100/50">
          <div className="border-b border-violet-100 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
            <div className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              <h2 className="text-lg font-bold">Ricerca intelligente sul grafo</h2>
            </div>
            <p className="mt-1 text-sm text-violet-100/90 max-w-2xl">
              Descrivi in italiano chi cerchi — MIRAX interpreta segnali, filtri tecnici e contesto, poi interroga il
              Knowledge Graph in millisecondi.
            </p>
          </div>

          <form onSubmit={onSubmit} className="p-5 space-y-4">
            <label className="block">
              <span className="sr-only">Query in linguaggio naturale</span>
              <textarea
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                rows={3}
                placeholder='Es. "Software house a Milano senza Meta Pixel che assumono sviluppatori"'
                disabled={loading}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 disabled:opacity-60"
              />
            </label>

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">
                Città (opzionale, sovrascrive)
                <input
                  className="mt-1 block w-36 rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                  value={cityOverride}
                  onChange={(e) => setCityOverride(e.target.value)}
                  placeholder="Auto da query"
                  disabled={loading}
                />
              </label>
              <label className="text-xs text-slate-500">
                Limite
                <select
                  className="mt-1 block w-24 rounded-lg border border-slate-200 px-2.5 py-2 text-sm bg-white"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  disabled={loading}
                >
                  {[25, 50, 75, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                disabled={loading || !query.trim()}
                className="ml-auto gap-2 bg-violet-600 hover:bg-violet-700 px-6"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ricerca…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Cerca nel grafo
                  </>
                )}
              </Button>
            </div>

            <p className="text-[11px] text-slate-400">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">Ctrl</kbd>
              {' + '}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
              {' per avviare · Nessun credito consumato — legge solo il grafo indicizzato'}
            </p>
          </form>
        </Card>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Prova con un esempio
        </p>
        <div className="flex flex-wrap gap-2">
          {AGENTIC_EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={loading}
              onClick={() => void runSearch(ex)}
              className="rounded-full border border-violet-200/80 bg-white px-3 py-1.5 text-left text-xs font-medium text-violet-900 transition hover:border-violet-400 hover:bg-violet-50 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
          <Loader2 className="h-5 w-5 animate-spin text-violet-600 shrink-0" />
          <p className="text-sm font-medium text-violet-900">{AGENTIC_LOADING_COPY[phase]}</p>
        </div>
      ) : null}

      {state.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{state.error}</div>
      ) : null}

      {result && signalIntent && universeQuery ? (
        <div className="space-y-4">
          <AgenticIntentBreakdown
            intent={signalIntent}
            intentSummary={result.intent_summary}
            parseSource={result.parse_source}
          />
          <AgenticQueryPlan query={universeQuery} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-900 tabular-nums">{result.total}</span> entità trovate
              {result.results.length < result.total ? (
                <span className="text-slate-400"> · mostrate {result.results.length}</span>
              ) : null}
              {typeof result.results[0]?.graph_score === 'number' ? (
                <span className="text-slate-400"> · ordinati per Graph Rank</span>
              ) : null}
              {typeof result.elapsed_ms === 'number' ? (
                <span className="text-slate-400"> · {result.elapsed_ms} ms</span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {result.results.length > 0 ? (
                <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" />
                  Esporta CSV
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/dashboard">Nuova ricerca Maps →</Link>
              </Button>
            </div>
          </div>

          {result.results.length > 0 ? (
            <AgenticResultsResponsive
              results={result.results}
              table={<AgenticResultsTable results={result.results} />}
            />
          ) : (
            <Card className="border-dashed p-8 text-center">
              <p className="font-semibold text-slate-800">Nessun match nel grafo</p>
              <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
                L&apos;interpretazione è corretta, ma il grafo non contiene ancora aziende che soddisfano tutti i criteri.
                Prova a allargare la query, verifica che <code className="text-xs bg-slate-100 px-1 rounded">UNIVERSE_ENABLED=1</code>{' '}
                sia attivo, oppure avvia una ricerca Maps per popolare il sidecar.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void runSearch(query)}>
                  Riprova
                </Button>
                <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700">
                  <Link href="/dashboard">Ricerca Maps classica</Link>
                </Button>
              </div>
            </Card>
          )}
        </div>
      ) : null}

      {!state.hasSearched && !loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { title: 'Linguaggio naturale', body: 'Scrivi come parli: settore, città, segnali, filtri tech.' },
            { title: 'Trasparenza totale', body: 'Vedi cosa ha capito MIRAX e il piano query sul grafo.' },
            { title: 'Zero crediti', body: 'Legge solo entità già indicizzate — nessun scrape Maps.' },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
