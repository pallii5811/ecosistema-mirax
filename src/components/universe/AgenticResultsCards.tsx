'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, MapPin, Network, ThumbsUp, ThumbsDown } from 'lucide-react'
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
import { LeadEvidenceCard, type CommercialSignalUi, type EvidenceUi } from './LeadEvidenceCard'
import { recordUniverseFeedback } from '@/lib/universe/client'
import { cn } from '@/lib/utils'

type Props = {
  results: Record<string, unknown>[]
  userQuery?: string
}

export function AgenticResultsCards({ results, userQuery }: Props) {
  const [feedbackSent, setFeedbackSent] = useState<Set<string>>(new Set())

  const sendFeedback = async (entityId: string, action: 'thumb_up' | 'thumb_down') => {
    const key = `${entityId}:${action}`
    if (feedbackSent.has(key)) return
    try {
      await recordUniverseFeedback({ entity_id: entityId, action, user_query: userQuery || null })
      setFeedbackSent((prev) => new Set(prev).add(key))
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="space-y-3 md:hidden">
      {results.map((lead, idx) => {
        const name = readLeadString(lead, ['azienda', 'nome']) || '—'
        const city = readLeadString(lead, ['citta', 'city'])
        const site = readLeadString(lead, ['sito', 'website'])
        const entityId = typeof lead.entity_id === 'string' ? lead.entity_id : null
        const graphScore = typeof lead.graph_score === 'number' ? lead.graph_score : null
        const opportunityScore = typeof lead.opportunity_score === 'number' ? lead.opportunity_score : (graphScore ?? calcOpportunityScore(lead))
        const evidence = graphScore != null ? buildGraphRankEvidence(readGraphRankFactors(lead)) : []

        return (
          <article
            key={entityId ?? `${name}-${idx}`}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 truncate">{name}</h3>
                {city ? (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {city}
                  </p>
                ) : null}
              </div>
              <span
                title={graphScore != null ? GRAPH_RANK_TOOLTIP : 'Opportunity score'}
                className={cn('shrink-0 rounded-lg px-2 py-1 text-xs font-bold tabular-nums', graphRankScoreClass(opportunityScore))}
              >
                {opportunityScore}
              </span>
            </div>
            {evidence.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
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
            <div className="mt-3 flex flex-wrap gap-2">
              {entityId ? <SaveToGraphButton entityId={entityId} /> : null}
              {entityId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500"
                  aria-label="Utile"
                  title="Utile"
                  disabled={feedbackSent.has(`${entityId}:thumb_up`)}
                  onClick={() => sendFeedback(entityId, 'thumb_up')}
                >
                  <ThumbsUp className={cn('h-3.5 w-3.5', feedbackSent.has(`${entityId}:thumb_up`) && 'fill-emerald-500 text-emerald-500')} />
                </Button>
              ) : null}
              {entityId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-500"
                  aria-label="Non utile"
                  title="Non utile"
                  disabled={feedbackSent.has(`${entityId}:thumb_down`)}
                  onClick={() => sendFeedback(entityId, 'thumb_down')}
                >
                  <ThumbsDown className={cn('h-3.5 w-3.5', feedbackSent.has(`${entityId}:thumb_down`) && 'fill-rose-500 text-rose-500')} />
                </Button>
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
                <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs">
                  <a href={site.startsWith('http') ? site : `https://${site}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Sito
                  </a>
                </Button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

/** Desktop table wrapper hides on mobile; cards show on mobile only. */
export function AgenticResultsResponsive({
  results,
  table,
  userQuery,
}: {
  results: Record<string, unknown>[]
  table: React.ReactNode
  userQuery?: string
}) {
  return (
    <>
      <div className="hidden md:block">{table}</div>
      <AgenticResultsCards results={results} userQuery={userQuery} />
    </>
  )
}
