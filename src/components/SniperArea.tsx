'use client'

import { Sparkles, CreditCard, Search } from 'lucide-react'

const BASE_LEAD_OPTIONS = [10, 25, 50, 100, 200, 300, 400, 500, 750, 1000, 2000, 5000]

function buildLeadOptions(credits: number): number[] {
  const out = BASE_LEAD_OPTIONS.filter((n) => n <= credits)
  if (credits > 500 && !out.includes(credits)) out.push(credits)
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

type SniperAreaProps = {
  query: string
  onQueryChange: (value: string) => void
  onStart: () => void | Promise<void>
  isLoading: boolean
  error: string | null
  aiDebug?: unknown
  maxLeads: number
  onMaxLeadsChange: (value: number) => void
  credits: number
}

const SniperArea = ({ query, onQueryChange, onStart, isLoading, error, aiDebug, maxLeads, onMaxLeadsChange, credits }: SniperAreaProps) => {
  const leadOptions = buildLeadOptions(Math.max(credits, 10))
  const selectValue = leadOptions.includes(maxLeads) ? maxLeads : (leadOptions[leadOptions.length - 1] ?? maxLeads)

  return (
    <div className="relative mb-4">
      {/* Enterprise glow — strong visible pulse */}
      <div className="pointer-events-none absolute -inset-4 rounded-[36px] bg-gradient-to-r from-violet-500/25 via-purple-400/20 to-indigo-500/25 blur-xl animate-[searchGlow_3s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute -inset-[3px] rounded-full bg-gradient-to-r from-violet-400/30 via-purple-300/15 to-violet-400/30 animate-[searchBorder_2.5s_ease-in-out_infinite]" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onStart()
        }}
        className="relative"
      >
        {/* Search bar */}
        <div className="flex items-center gap-3.5 bg-white rounded-full border-2 border-violet-200/70 shadow-xl shadow-violet-200/40 px-6 sm:px-8 py-2 focus-within:border-violet-500 focus-within:shadow-violet-400/50 focus-within:shadow-2xl transition-all duration-300 hover:border-violet-300 hover:shadow-violet-300/40">
          <Search className="w-7 h-7 text-violet-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Cerca aziende... es. Ristoranti a Roma senza sito"
            title="Scrivi categoria + città per trovare lead. Puoi aggiungere filtri come 'senza sito', 'senza Pixel', 'errori SEO'."
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
                  {n === credits && n > 500 ? `Tutti (${n} crediti)` : `${n} lead`}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isLoading || credits <= 0}
              title="Avvia la ricerca nel database. Ogni lead trovato costa 1 credito."
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-8 py-3.5 rounded-full text-[15px] shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all duration-200 hover:scale-[1.03] disabled:scale-100"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Ricerca...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>Cerca</span>
                </>
              )}
            </button>
          </div>

          {/* Mobile: just the search button */}
          <button
            type="submit"
            disabled={isLoading || credits <= 0}
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
                {n === credits && n > 500 ? `Tutti (${n})` : `${n} lead`}
              </option>
            ))}
          </select>
          <span className="text-[11px] font-semibold text-slate-400">
            {Math.min(maxLeads, credits)} crediti
          </span>
        </div>
      </form>

      {/* Info row below search */}
      <div className="flex items-center justify-between px-6 mt-2">
        <div className="flex items-center gap-4">
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Database verificato
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Ricerca AI
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            GDPR
          </span>
        </div>
        <span className="text-[12px] font-semibold text-slate-400">
          {Math.min(maxLeads, credits)} crediti
        </span>
      </div>

      {isLoading && aiDebug ? (
        <p className="text-[11px] text-violet-600 font-medium animate-pulse text-center mt-1">
          {(() => {
            const d = aiDebug as any
            return `Cercando: ${d?.category || '—'} in ${d?.city || '—'}...`
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
