'use client'

import { Database, Sparkles, Zap } from 'lucide-react'

export type SearchCacheMeta = {
  source?: 'db_merged' | 'cached_completed' | 'fresh_scrape'
  db_raw?: number
  db_with_contact?: number
  jobs_merged?: number
  needs_more_scrape?: boolean
  canonical_job_id?: string | null
}

export function SearchIntelBanner({
  meta,
  displayed,
  maxLeads,
}: {
  meta: SearchCacheMeta | null
  displayed: number
  maxLeads: number
}) {
  if (!meta || (meta.db_raw ?? 0) <= 0) return null

  const fromDb = meta.db_with_contact ?? 0
  const jobs = meta.jobs_merged ?? 0
  const scraping = meta.needs_more_scrape && displayed < maxLeads

  return (
    <div className="mx-4 mb-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 text-sm text-slate-800">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-violet-100 p-2">
          <Database className="w-4 h-4 text-violet-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-violet-900">
            {fromDb > 0
              ? `${fromDb} lead già nel database (${jobs} ricerche unite)`
              : 'Ricerca avviata su Maps'}
          </p>
          <p className="text-slate-600 mt-0.5 text-[13px] leading-relaxed">
            {fromDb > 0 && displayed > 0
              ? `Mostrati subito ${displayed} con contatto verificato. `
              : ''}
            {scraping
              ? `Sto cercando altri lead fino a ${maxLeads} — i risultati si aggiornano in tempo reale.`
              : displayed >= maxLeads
                ? 'Obiettivo raggiunto. I lead restano salvati per le prossime ricerche sulla stessa categoria e città.'
                : 'Mercato esaurito per questa combinazione categoria/città.'}
          </p>
          {scraping ? (
            <p className="flex items-center gap-1.5 text-violet-700 text-xs font-medium mt-2">
              <Zap className="w-3.5 h-3.5 animate-pulse" />
              Scrape incrementale attivo — non serve rifare la ricerca da zero
            </p>
          ) : fromDb > 0 ? (
            <p className="flex items-center gap-1.5 text-emerald-700 text-xs font-medium mt-2">
              <Sparkles className="w-3.5 h-3.5" />
              Prossima ricerca stessa categoria/città: risposta istantanea dal DB
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
