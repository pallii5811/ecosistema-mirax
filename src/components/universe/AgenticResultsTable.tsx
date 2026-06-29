'use client'

import Link from 'next/link'
import { Building2, Copy, ExternalLink, MapPin, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { calcOpportunityScore } from '@/components/ResultsTable'
import {
  GRAPH_RANK_TOOLTIP,
  buildGraphRankEvidence,
  graphRankScoreClass,
  readGraphRankFactors,
  readLeadString,
} from '@/lib/universe/agentic-ui'
import { SaveToGraphButton } from './SaveToGraphButton'
import { cn } from '@/lib/utils'

type Props = {
  results: Record<string, unknown>[]
  className?: string
}

function TechPill({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  if (ok === null || ok === undefined) return null
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold',
        ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
      )}
    >
      {ok ? label : `No ${label}`}
    </span>
  )
}

export function AgenticResultsTable({ results, className }: Props) {
  if (!results.length) return null

  const copySite = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Azienda</th>
              <th className="px-4 py-3">Località</th>
              <th className="px-4 py-3">Tech stack</th>
              <th className="px-4 py-3 text-center">Graph rank</th>
              <th className="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.map((lead, idx) => {
              const name = readLeadString(lead, ['azienda', 'nome', 'name']) || '—'
              const city = readLeadString(lead, ['citta', 'city', 'localita'])
              const category = readLeadString(lead, ['categoria', 'category'])
              const site = readLeadString(lead, ['sito', 'website', 'url'])
              const entityId = typeof lead.entity_id === 'string' ? lead.entity_id : null
              const graphScore = typeof lead.graph_score === 'number' ? lead.graph_score : null
              const score = graphScore ?? calcOpportunityScore(lead)
              const rating = lead.rating
              const evidence = graphScore != null ? buildGraphRankEvidence(readGraphRankFactors(lead)) : []

              return (
                <tr key={entityId ?? `${name}-${idx}`} className="hover:bg-violet-50/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate max-w-[220px]">{name}</p>
                        {category ? <p className="text-xs text-slate-500 truncate max-w-[220px]">{category}</p> : null}
                        {site ? (
                          <a
                            href={site.startsWith('http') ? site : `https://${site}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-violet-600 hover:underline truncate block max-w-[220px]"
                          >
                            {site.replace(/^https?:\/\//, '')}
                          </a>
                        ) : null}
                        {evidence.length ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {evidence.map((ev) => (
                              <span
                                key={ev}
                                className="inline-flex rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-700"
                              >
                                {ev}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {city ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        {city}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <TechPill ok={lead.meta_pixel as boolean | null} label="Pixel" />
                      <TechPill ok={lead.google_tag_manager as boolean | null} label="GTM" />
                      <TechPill ok={lead.ssl as boolean | null} label="SSL" />
                      {typeof rating === 'number' ? (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                          ★ {rating}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      title={graphScore != null ? GRAPH_RANK_TOOLTIP : 'Opportunity score'}
                      className={cn(
                        'inline-flex min-w-[2rem] justify-center rounded-lg px-2 py-1 text-xs font-bold tabular-nums',
                        graphRankScoreClass(score),
                      )}
                    >
                      {score}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {site ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Copia sito"
                          onClick={() => copySite(site.startsWith('http') ? site : `https://${site}`)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {entityId ? (
                        <SaveToGraphButton entityId={entityId} compact />
                      ) : null}
                      {entityId ? (
                        <Button asChild variant="outline" size="sm" className="h-8 gap-1 text-xs">
                          <Link href={`/dashboard/universe/${entityId}`}>
                            <Network className="h-3.5 w-3.5" />
                            Grafo
                          </Link>
                        </Button>
                      ) : null}
                      {site ? (
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <a href={site.startsWith('http') ? site : `https://${site}`} target="_blank" rel="noopener noreferrer" title="Apri sito">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
