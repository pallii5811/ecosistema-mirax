'use client'

import { useRef } from 'react'
import { Search, Briefcase } from 'lucide-react'
import { MAX_LEADS_PER_SEARCH } from '@/lib/search-job-payload'
import { BUSINESS_SIGNAL_FILTER_OPTIONS, type BusinessSignalType } from '@/lib/business-events/types'
import { useDashboard } from '@/components/DashboardContext'
import { searchLocaleHint, t } from '@/lib/i18n'
import type { SearchSource } from '@/lib/search-source'

const BASE_LEAD_OPTIONS = [10, 25, 50, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000]

function buildLeadOptions(credits: number): number[] {
  const cap = Math.min(MAX_LEADS_PER_SEARCH, Math.max(10, Math.floor(credits)))
  const options = new Set(BASE_LEAD_OPTIONS.filter((n) => n <= cap))
  // If the user has a non-round credit balance (e.g. 4679), expose that exact
  // number so the selected target can always match the real available budget.
  if (cap >= 10) options.add(cap)
  return Array.from(options).sort((a, b) => a - b)
}

type SniperAreaProps = {
  query: string
  onQueryChange: (value: string) => void
  onStart: (submittedQuery: string) => void | Promise<void>
  isLoading: boolean
  error: string | null
  aiDebug?: unknown
  maxLeads: number
  onMaxLeadsChange: (value: number) => void
  credits: number
  businessSignalFilters?: BusinessSignalType[]
  onBusinessSignalFiltersChange?: (value: BusinessSignalType[]) => void
  searchSource?: SearchSource
}

const SniperArea = ({
  query,
  onQueryChange,
  onStart,
  isLoading,
  error,
  aiDebug,
  maxLeads,
  onMaxLeadsChange,
  credits,
  businessSignalFilters = [],
  onBusinessSignalFiltersChange,
  searchSource = 'maps',
}: SniperAreaProps) => {
  const { locale } = useDashboard()
  const inputRef = useRef<HTMLInputElement>(null)
  const localeHint = searchLocaleHint(locale)
  const leadOptions = buildLeadOptions(Math.max(credits, 10))
  const selectValue = leadOptions.includes(maxLeads) ? maxLeads : (leadOptions[leadOptions.length - 1] ?? maxLeads)

  const toggleBusinessFilter = (id: BusinessSignalType) => {
    if (!onBusinessSignalFiltersChange) return
    const set = new Set(businessSignalFilters)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onBusinessSignalFiltersChange(Array.from(set))
  }

  return (
    <div className="relative mb-4">
      {/* Enterprise glow — strong visible pulse */}
      <div className="pointer-events-none absolute -inset-4 rounded-[36px] bg-gradient-to-r from-violet-500/25 via-purple-400/20 to-indigo-500/25 blur-xl animate-[searchGlow_3s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute -inset-[3px] rounded-full bg-gradient-to-r from-violet-400/30 via-purple-300/15 to-violet-400/30 animate-[searchBorder_2.5s_ease-in-out_infinite]" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const submitted = (inputRef.current?.value ?? query).trim()
          onStart(submitted)
        }}
        className="relative"
      >
        {/* Search bar */}
        <div className="flex items-center gap-3.5 bg-white rounded-full border-2 border-violet-200/70 shadow-xl shadow-violet-200/40 px-6 sm:px-8 py-2 focus-within:border-violet-500 focus-within:shadow-violet-400/50 focus-within:shadow-2xl transition-all duration-300 hover:border-violet-300 hover:shadow-violet-300/40">
          <Search className="w-7 h-7 text-violet-500 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t(locale, 'search_placeholder')}
            title="Scrivi in linguaggio naturale: assunzioni, gare d'appalto, investimenti settoriali, cambi CRM, filtri tecnici…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="flex-1 bg-transparent text-base sm:text-[22px] text-slate-900 placeholder:text-slate-400 outline-none py-4 sm:py-5 min-w-0 font-medium tracking-[-0.01em]"
          />

          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <select
              value={selectValue}
              onChange={(e) => onMaxLeadsChange(Number(e.target.value))}
              disabled={isLoading}
              className="bg-slate-50 border border-slate-200 rounded-full text-[12px] font-semibold text-slate-600 pl-3 pr-7 py-2 outline-none focus:border-violet-400 cursor-pointer disabled:opacity-50"
            >
              {leadOptions.map((n) => (
                <option key={n} value={n}>
                  {n} {t(locale, 'max_leads')}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isLoading || (searchSource !== 'graph' && credits <= 0)}
              title="Avvia la ricerca nel database. Ogni lead trovato costa 1 credito."
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-8 py-3.5 rounded-full text-[15px] shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all duration-200 hover:scale-[1.03] disabled:scale-100"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>{t(locale, 'searching')}</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>{t(locale, 'search_button')}</span>
                </>
              )}
            </button>
          </div>

          {/* Mobile: just the search button */}
          <button
            type="submit"
            disabled={isLoading || (searchSource !== 'graph' && credits <= 0)}
            className="sm:hidden flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-purple-600 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-4 py-2.5 rounded-full text-sm shadow-lg shadow-violet-500/25 flex-shrink-0"
          >
            <Search className="h-4 w-4" />
            <span>Cerca</span>
          </button>
        </div>

        {/* Mobile: lead selector row below search bar */}
        <div className="flex sm:hidden items-center justify-between mt-2 px-2">
          <select
            value={selectValue}
            onChange={(e) => onMaxLeadsChange(Number(e.target.value))}
            disabled={isLoading}
            className="bg-slate-50 border border-slate-200 rounded-full text-xs font-semibold text-slate-600 pl-3 pr-7 py-2 outline-none focus:border-violet-400 cursor-pointer disabled:opacity-50"
          >
            {leadOptions.map((n) => (
              <option key={n} value={n}>
                {n === credits && n > 500 ? `Tutti (${n})` : `${n} ${t(locale, 'max_leads')}`}
              </option>
            ))}
          </select>
          <span className="text-[11px] font-semibold text-slate-400">
            Max {Math.min(maxLeads, credits, MAX_LEADS_PER_SEARCH)} {t(locale, 'max_leads')}
          </span>
        </div>
      </form>

      {onBusinessSignalFiltersChange ? (
        <div className="mt-3 px-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Briefcase className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Segnale business</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BUSINESS_SIGNAL_FILTER_OPTIONS.map((opt) => {
              const active = businessSignalFilters.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.hint}
                  disabled={isLoading}
                  onClick={() => toggleBusinessFilter(opt.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-violet-400 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-600'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Info row below search */}
      <div className="flex items-center justify-between px-6 mt-2">
        <div className="flex items-center gap-4">
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t(locale, 'database_verified')}
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            {t(locale, 'ai_search')}
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            {t(locale, 'gdpr')}
          </span>
        </div>
        <span className="text-[12px] font-semibold text-slate-400">
          Max {Math.min(maxLeads, credits, MAX_LEADS_PER_SEARCH)} {t(locale, 'max_leads')} · {credits.toLocaleString(locale === 'es' ? 'es-ES' : 'it-IT')} {t(locale, 'credits')}
        </span>
      </div>

      {localeHint ? (
        <p className="mt-2 px-6 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg py-2 mx-2">
          {localeHint}
        </p>
      ) : null}

      {isLoading && aiDebug ? (
        <p className="text-[11px] text-violet-600 font-medium animate-pulse text-center mt-1">
          {(() => {
            const d = aiDebug as Record<string, unknown>
            return `Cercando: ${String(d?.category || '—')} in ${String(d?.city || '—')}...`
          })()}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">{error}</div>
      ) : null}

      <style>{`
        @keyframes searchGlow {
          0%, 100% { opacity: 0.4; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1.02); }
        }
        @keyframes searchBorder {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}

export default SniperArea
