'use client'

import { useState } from 'react'
import { Search, Sparkles, Wrench } from 'lucide-react'
import {
  buildDiscoverySearchQuery,
  getDiscoveryIntentsForLocale,
  type DiscoveryIntentId,
} from '@/lib/discovery-intent-map'
import { MAX_LEADS_PER_SEARCH } from '@/lib/search-job-payload'
import { useDashboard } from '@/components/DashboardContext'

type Props = {
  onSearch: (query: string) => void | Promise<void>
  isLoading: boolean
  error: string | null
  credits: number
  maxLeads: number
  onMaxLeadsChange: (n: number) => void
}

const BASE_LEAD_OPTIONS = [10, 25, 50, 100, 200, 300, 400, 500]

function buildLeadOptions(credits: number): number[] {
  const cap = Math.min(MAX_LEADS_PER_SEARCH, Math.max(10, credits))
  return BASE_LEAD_OPTIONS.filter((n) => n <= cap)
}

export function DiscoverySearchWizard({
  onSearch,
  isLoading,
  error,
  credits,
  maxLeads,
  onMaxLeadsChange,
}: Props) {
  const { locale } = useDashboard()
  const intents = getDiscoveryIntentsForLocale(locale)
  const [intentId, setIntentId] = useState<DiscoveryIntentId>('siti_web')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')

  const intent = intents.find((i) => i.id === intentId) ?? intents[0]
  const leadOptions = buildLeadOptions(Math.max(credits, 10))
  const selectValue = leadOptions.includes(maxLeads) ? maxLeads : (leadOptions[leadOptions.length - 1] ?? maxLeads)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const c = city.trim()
    if (!c) return
    const q = buildDiscoverySearchQuery({
      intentId,
      city: c,
      category: category.trim() || undefined,
      locale,
    })
    void onSearch(q)
  }

  return (
    <div className="relative mb-4">
      <div className="pointer-events-none absolute -inset-3 rounded-3xl bg-gradient-to-r from-violet-400/15 via-purple-300/10 to-indigo-400/15 blur-lg" />

      <form onSubmit={handleSubmit} className="relative rounded-2xl border border-violet-200/80 bg-white shadow-lg shadow-violet-100/50 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-5 w-5 text-violet-600" />
          <h3 className="text-base font-bold text-slate-900">Trova clienti in 3 passi</h3>
        </div>
        <p className="text-sm text-slate-500 -mt-2">Niente termini tecnici — ti mostriamo chi contattare e perché.</p>

        <div>
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">1. Cosa vendi?</label>
          <select
            value={intentId}
            onChange={(e) => setIntentId(e.target.value as DiscoveryIntentId)}
            disabled={isLoading}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-violet-400"
          >
            {intents.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-violet-600">{intent.hint}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">2. Settore (opz.)</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={intent.placeholderCategory}
              disabled={isLoading}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">3. Città *</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="es. Milano, Roma, Verona…"
              required
              disabled={isLoading}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
          <select
            value={selectValue}
            onChange={(e) => onMaxLeadsChange(Number(e.target.value))}
            disabled={isLoading}
            className="rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 pl-3 pr-8 py-2 outline-none focus:border-violet-400"
          >
            {leadOptions.map((n) => (
              <option key={n} value={n}>
                {n} lead max
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={isLoading || credits <= 0 || !city.trim()}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white font-bold px-6 py-3 text-sm shadow-lg shadow-violet-500/20 transition-all"
          >
            {isLoading ? (
              <>
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Ricerca…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Trova clienti
              </>
            )}
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <p className="text-[11px] text-slate-400 text-center">
          {credits.toLocaleString('it-IT')} crediti · Max {Math.min(maxLeads, credits, MAX_LEADS_PER_SEARCH)} lead
        </p>
      </form>
    </div>
  )
}

export default DiscoverySearchWizard
