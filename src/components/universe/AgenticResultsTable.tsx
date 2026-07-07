'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, Copy, ExternalLink, MapPin, Network, Trash2, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { calcOpportunityScore } from '@/components/ResultsTable'
import {
  GRAPH_RANK_TOOLTIP,
  buildGraphRankEvidence,
  graphRankScoreClass,
  readGraphRankFactors,
  readLeadString,
} from '@/lib/universe/agentic-ui'
import { setUniverseUserContext, recordUniverseFeedback } from '@/lib/universe/client'
import { SaveToGraphButton } from './SaveToGraphButton'
import { LeadEvidenceCard, type CommercialSignalUi, type EvidenceUi } from './LeadEvidenceCard'
import { cn } from '@/lib/utils'

type Props = {
  results: Record<string, unknown>[]
  className?: string
  userQuery?: string
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

export function AgenticResultsTable({ results, className, userQuery }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [feedbackSent, setFeedbackSent] = useState<Set<string>>(new Set())

  const selectable = useMemo(
    () =>
      results
        .map((lead, idx) => {
          const entityId = typeof lead.entity_id === 'string' ? lead.entity_id : null
          return {
            lead,
            idx,
            entityId,
            site: readLeadString(lead, ['sito', 'website', 'url']),
            name: readLeadString(lead, ['azienda', 'nome', 'name']) || '—',
          }
        })
        .filter((r): r is typeof r & { entityId: string } => Boolean(r.entityId)),
    [results],
  )

  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.entityId))
  const someSelected = selectable.some((r) => selected.has(r.entityId)) && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map((r) => r.entityId)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const copySites = async () => {
    const sites = selectable
      .filter((r) => selected.has(r.entityId))
      .map((r) => (r.site?.startsWith('http') ? r.site : `https://${r.site}`))
      .filter(Boolean)
    if (!sites.length) return
    try {
      await navigator.clipboard.writeText(sites.join('\n'))
      setBulkNotice(`${sites.length} siti copiati negli appunti`)
      setTimeout(() => setBulkNotice(null), 2500)
    } catch {
      /* ignore */
    }
  }

  const saveSelected = async () => {
    const ids = selectable.filter((r) => selected.has(r.entityId)).map((r) => r.entityId)
    if (!ids.length) return
    setBulkSaving(true)
    setBulkNotice(null)
    try {
      await Promise.all(ids.map((id) => setUniverseUserContext(id, 'saved')))
      setBulkNotice(`${ids.length} entità salvate nel grafo`)
      setTimeout(() => setBulkNotice(null), 2500)
    } catch {
      setBulkNotice('Errore durante il salvataggio multiplo')
    } finally {
      setBulkSaving(false)
    }
  }

  const toggleExpand = (id: string) => {
    const next = new Set(expandedRows)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedRows(next)
  }

  const sendFeedback = async (entityId: string, action: 'thumb_up' | 'thumb_down') => {
    const key = `${entityId}:${action}`
    if (feedbackSent.has(key)) return
    try {
      await recordUniverseFeedback({
        entity_id: entityId,
        action,
        user_query: userQuery || null,
      })
      setFeedbackSent((prev) => new Set(prev).add(key))
    } catch {
      /* ignore */
    }
  }

  if (!results.length) return null

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {selected.size > 0 ? (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
          <span className="text-xs font-semibold text-slate-700">{selected.size} selezionate</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={copySites}
            >
              <Copy className="h-3.5 w-3.5" />
              Copia siti
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={bulkSaving}
              onClick={saveSelected}
            >
              Salva nel grafo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-500"
              aria-label="Deseleziona tutto"
              onClick={() => setSelected(new Set())}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {bulkNotice ? (
        <div className="border-b border-slate-100 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-800">
          {bulkNotice}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Seleziona tutto"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
              </th>
              <th className="px-4 py-3">Azienda</th>
              <th className="px-4 py-3">Località</th>
              <th className="px-4 py-3">Tech stack</th>
              <th className="px-4 py-3 text-center">Opportunity</th>
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
              const opportunityScore = typeof lead.opportunity_score === 'number' ? lead.opportunity_score : (graphScore ?? calcOpportunityScore(lead))
              const rating = lead.rating
              const evidence = graphScore != null ? buildGraphRankEvidence(readGraphRankFactors(lead)) : []
              const checked = entityId ? selected.has(entityId) : false
              const expanded = entityId ? expandedRows.has(entityId) : false

              return (
                <Fragment key={entityId ?? `${name}-${idx}`}>
                <tr className="hover:bg-violet-50/30 transition-colors">
                  <td className="px-4 py-3">
                    {entityId ? (
                      <input
                        type="checkbox"
                        aria-label={`Seleziona ${name}`}
                        checked={checked}
                        onChange={() => toggleOne(entityId)}
                        className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                    ) : null}
                  </td>
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
                        graphRankScoreClass(opportunityScore),
                      )}
                    >
                      {opportunityScore}
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
                          aria-label="Copia sito"
                          title="Copia sito"
                          onClick={() => {
                            const url = site.startsWith('http') ? site : `https://${site}`
                            navigator.clipboard.writeText(url).catch(() => {})
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {entityId ? (
                        <SaveToGraphButton entityId={entityId} compact />
                      ) : null}
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-500"
                          aria-label="Dettagli opportunità"
                          title="Dettagli opportunità"
                          onClick={() => toggleExpand(entityId)}
                        >
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Apri sito">
                          <a href={site.startsWith('http') ? site : `https://${site}`} target="_blank" rel="noopener noreferrer" title="Apri sito">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expanded && entityId ? (
                  <tr className="bg-slate-50/40">
                    <td colSpan={6} className="px-4 py-3">
                      <LeadEvidenceCard
                        opportunityScore={opportunityScore}
                        graphScore={graphScore ?? opportunityScore}
                        intentFitScore={typeof lead.intent_fit_score === 'number' ? lead.intent_fit_score : null}
                        signals={(Array.isArray(lead.commercial_signals) ? lead.commercial_signals : []) as CommercialSignalUi[]}
                        evidence={(Array.isArray(lead.commercial_evidence) ? lead.commercial_evidence : []) as EvidenceUi[]}
                        reasoning={typeof lead.commercial_reasoning === 'string' ? lead.commercial_reasoning : null}
                        entityId={entityId}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}
