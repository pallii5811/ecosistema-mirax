/**
 * Fase 10 — metriche Market Map (testabile da Node senza alias @/).
 */

import {
  computeSignalStrength,
  resolveSignalType,
  type CoreScorableSignal,
} from '../scoring/intent-score-core.ts'
import { buildIntentScoreBreakdown } from '../scoring/intent-score-core.ts'

export type MarketMapPoint = {
  id: string
  name: string
  kind: 'competitor' | 'lead'
  digitalMaturity: number
  growthRate: number
  estimatedRevenue: number
  intentScore: number
  category: string | null
  city: string | null
}

export type MarketMapFilters = {
  category?: string
  city?: string
  minIntent?: number
}

const GROWTH_WEIGHTS: Record<string, number> = {
  hiring: 35,
  tender_won: 40,
  funding_received: 28,
  sector_investment: 18,
  registry_change: 12,
  executive_change: 10,
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

function collectSignals(lead: Record<string, unknown>): CoreScorableSignal[] {
  const out: CoreScorableSignal[] = []
  const bs = lead.business_signals
  if (Array.isArray(bs)) {
    for (const s of bs) {
      if (s && typeof s === 'object') out.push(s as CoreScorableSignal)
    }
  }
  const keys = [
    'business_hiring_jobs',
    'business_tender_hits',
    'business_sector_hits',
    'detected_crm_stack',
    'audit_changes',
  ]
  for (const k of keys) {
    const v = lead[k]
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') {
          out.push(item as CoreScorableSignal)
        }
      }
    }
  }
  if (lead.has_google_ads === true) {
    out.push({ type: 'google_ads_started', title: 'Google Ads attivo', confidence: 70 })
  }
  if (lead.has_meta_ads === true) {
    out.push({ type: 'meta_ads_started', title: 'Meta Ads attivo', confidence: 65 })
  }
  return out
}

export function computeDigitalMaturityFromLead(lead: Record<string, unknown>): number {
  let score = 20
  const signals = collectSignals(lead)
  const types = new Set(signals.map(resolveSignalType).filter(Boolean))

  if (types.has('google_ads_started') || lead.has_google_ads === true) score += 18
  if (types.has('meta_ads_started') || lead.has_meta_ads === true) score += 12
  if (types.has('crm_detected') || lead.detected_crm_stack) score += 20
  if (!types.has('site_stale')) score += 10

  const tech = lead.tech_stack
  if (Array.isArray(tech) && tech.length >= 4) score += 12
  else if (Array.isArray(tech) && tech.length >= 2) score += 6

  const tr = lead.technical_report
  if (tr && typeof tr === 'object') {
    const perf = (tr as Record<string, unknown>).performance_score
    if (typeof perf === 'number') score += clamp(perf / 5, 0, 15)
  }

  if (lead.website || lead.sito) score += 8
  return clamp(score)
}

export function computeGrowthRateFromSignals(signals: CoreScorableSignal[]): number {
  const types = new Set(signals.map(resolveSignalType).filter(Boolean))
  let rate = 0
  for (const [t, w] of Object.entries(GROWTH_WEIGHTS)) {
    if (types.has(t)) rate += w
  }
  return clamp(rate)
}

export function parseEstimatedRevenue(lead: Record<string, unknown>): number {
  const tryNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^\d.,]/g, '').replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n
    }
    return null
  }

  for (const key of ['fatturato', 'revenue', 'estimated_revenue', 'annual_revenue']) {
    const n = tryNum(lead[key])
    if (n) return n
  }

  const storico = lead.storico_bilanci
  if (Array.isArray(storico) && storico[0] && typeof storico[0] === 'object') {
    const n = tryNum((storico[0] as Record<string, unknown>).fatturato)
    if (n) return n
  }

  const score = lead.score
  if (typeof score === 'number' && score > 0) {
    return clamp(score, 1, 100) * 50_000
  }

  return 300_000
}

export function intentScoreToColor(score: number): string {
  const t = clamp(score) / 100
  const r = Math.round(220 - t * 96)
  const g = Math.round(38 + t * 20)
  const b = Math.round(38 + t * 199)
  return `rgb(${r},${g},${b})`
}

export function revenueToRadius(revenue: number, minRev: number, maxRev: number): number {
  const lo = Math.max(1, minRev)
  const hi = Math.max(lo + 1, maxRev)
  const norm = (revenue - lo) / (hi - lo)
  return 6 + Math.sqrt(Math.max(0, Math.min(1, norm))) * 22
}

export function leadToMarketPoint(
  lead: Record<string, unknown>,
  id: string,
  kind: 'competitor' | 'lead',
): MarketMapPoint {
  const signals = collectSignals(lead)
  const intent = buildIntentScoreBreakdown(signals).score
  return {
    id,
    name: String(lead.name || lead.nome || lead.azienda || 'Senza nome').trim(),
    kind,
    digitalMaturity: computeDigitalMaturityFromLead(lead),
    growthRate: computeGrowthRateFromSignals(signals),
    estimatedRevenue: parseEstimatedRevenue(lead),
    intentScore: intent,
    category: String(lead.category || lead.categoria || '').trim() || null,
    city: String(lead.city || lead.citta || '').trim() || null,
  }
}

export function filterMarketPoints(
  points: MarketMapPoint[],
  filters: MarketMapFilters,
): MarketMapPoint[] {
  const cat = filters.category?.toLowerCase().trim()
  const city = filters.city?.toLowerCase().trim()
  const minIntent = typeof filters.minIntent === 'number' ? filters.minIntent : 0

  return points.filter((p) => {
    if (minIntent > 0 && p.intentScore < minIntent) return false
    if (cat && !(p.category || '').toLowerCase().includes(cat)) return false
    if (city && !(p.city || '').toLowerCase().includes(city)) return false
    return true
  })
}

export function pickStrongCompetitorSignals(
  signals: CoreScorableSignal[],
  threshold = 55,
): Array<{ type: string; title: string; strength: number }> {
  const strongTypes = new Set(['tender_won', 'funding_received', 'hiring', 'sector_investment'])
  const out: Array<{ type: string; title: string; strength: number }> = []

  for (const s of signals) {
    const type = resolveSignalType(s)
    if (!type || !strongTypes.has(type)) continue
    const strength = computeSignalStrength(s)
    if (strength >= threshold) {
      out.push({
        type,
        title: String(s.title || `Segnale ${type}`),
        strength,
      })
    }
  }

  return out.sort((a, b) => b.strength - a.strength)
}

export function buildCompetitorAlertCopy(
  competitorName: string,
  signal: { type: string; title: string; strength: number },
  city?: string | null,
): { title: string; body: string } {
  const zone = city ? ` nella tua zona (${city})` : ' nella tua zona'
  if (signal.type === 'tender_won') {
    return {
      title: `🏁 ${competitorName} ha vinto una gara${zone}`,
      body: `${signal.title}. Opportunità per posizionarti sul mercato locale?`,
    }
  }
  if (signal.type === 'funding_received') {
    return {
      title: `💰 ${competitorName} ha ricevuto funding`,
      body: `${signal.title}. Monitora la loro espansione commerciale.`,
    }
  }
  if (signal.type === 'hiring') {
    return {
      title: `📈 ${competitorName} sta assumendo`,
      body: `${signal.title}. Segnale di crescita — valuta un approccio commerciale.`,
    }
  }
  return {
    title: `⚡ Segnale forte da ${competitorName}`,
    body: signal.title,
  }
}
