'use client'

import { Flame } from 'lucide-react'
import { IntentScoreBadge } from '@/components/IntentScoreBadge'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'

type HotLeadAlert = {
  id: string
  leadName: string
  website: string
  score: number
  signalTitle: string
  at: string
}

type Props = {
  results: unknown[]
  liveAlerts?: HotLeadAlert[]
}

function readName(lead: Record<string, unknown>): string {
  for (const k of ['azienda', 'nome', 'name', 'company']) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return 'Azienda'
}

function readWebsite(lead: Record<string, unknown>): string {
  for (const k of ['sito', 'website', 'url']) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function HotLeadsSection({ results, liveAlerts = [] }: Props) {
  const hotFromResults = results
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const lead = item as Record<string, unknown>
      const breakdown = calculateIntentScoreFromLead(lead)
      if (breakdown.score < 60) return null
      return {
        key: readWebsite(lead) || readName(lead),
        name: readName(lead),
        website: readWebsite(lead),
        breakdown,
      }
    })
    .filter(Boolean) as Array<{
    key: string
    name: string
    website: string
    breakdown: ReturnType<typeof calculateIntentScoreFromLead>
  }>

  const merged = [...hotFromResults]
  for (const alert of liveAlerts) {
    if (!merged.some((h) => h.key === alert.website || h.name === alert.leadName)) {
      merged.push({
        key: alert.website || alert.id,
        name: alert.leadName,
        website: alert.website,
        breakdown: {
          score: alert.score,
          basePoints: alert.score,
          recentMultiplier: 1,
          strengthMultiplier: 1,
          relationshipMultiplier: 1,
          contributors: [alert.signalTitle],
          signalTypes: [],
        },
      })
    }
  }

  if (merged.length === 0) return null

  return (
    <section className="mb-4 mx-1 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-5 w-5 text-violet-600" />
        <h2 className="text-sm font-bold text-violet-900">Hot Leads — Intent Score ≥ 60</h2>
        <span className="text-xs text-violet-600 font-medium">({merged.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {merged.slice(0, 12).map((h) => (
          <div
            key={h.key}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs shadow-sm"
            title={h.breakdown.contributors.join(' · ') || h.name}
          >
            <span className="font-semibold text-slate-800 max-w-[140px] truncate">{h.name}</span>
            <IntentScoreBadge breakdown={h.breakdown} compact />
          </div>
        ))}
      </div>
    </section>
  )
}

export type { HotLeadAlert }
export default HotLeadsSection
