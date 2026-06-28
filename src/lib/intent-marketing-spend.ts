/**
 * F2-B — Segnale unificato intent_marketing_spend
 * "Sta investendo in marketing" da Meta ads, Google ads, sito recente/performante.
 */

import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readNumber, readString } from '@/lib/business-events/types'
import { computeFreshnessScore } from '@/lib/lead-object'

function readBool(lead: Record<string, unknown>, keys: string[]): boolean {
  const tr = asRecord(lead.technical_report)
  for (const obj of [lead, tr]) {
    for (const key of keys) {
      if (obj[key] === true) return true
    }
  }
  return false
}

export function detectIntentMarketingSpend(lead: Record<string, unknown>): MiraxSignal | null {
  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const tr = asRecord(lead.technical_report)
  const evidence: MiraxSignal['evidence'] = []

  const activeMetaAds = readNumber(tr, ['active_meta_ads', 'meta_ads_count']) ?? readNumber(lead, ['active_meta_ads'])
  const metaVerified = lead.meta_ads_verified === true || tr.meta_ads_verified === true
  const hasGoogleAds = readBool(lead, ['google_ads', 'has_google_ads']) || tr.has_google_ads === true
  const hasPixel = readBool(lead, ['meta_pixel', 'has_pixel']) || tr.has_facebook_pixel === true
  const hasGtm = readBool(lead, ['google_tag_manager', 'has_gtm']) || tr.has_gtm === true

  const freshness =
    typeof lead.freshness_score === 'number'
      ? lead.freshness_score
      : computeFreshnessScore(lead.last_audited_at)
  const loadSpeed = readNumber(tr, ['load_speed_seconds', 'load_speed_s'])
  const perfScore = readNumber(tr, ['performance_score', 'pagespeed_score'])

  let score = 0

  if (metaVerified && activeMetaAds !== null && activeMetaAds > 0) {
    score += 40
    evidence.push({ label: 'Inserzioni Meta attive', value: String(activeMetaAds), source: 'meta_ad_library' })
  } else if (hasPixel) {
    score += 15
    evidence.push({ label: 'Meta Pixel', value: 'presente sul sito', source: 'website_audit' })
  }

  if (hasGoogleAds) {
    score += 30
    evidence.push({ label: 'Google Ads', value: 'tag rilevato', source: 'website_audit' })
  }

  const recentPerformantSite =
    freshness >= 70 &&
    (perfScore === null || perfScore >= 60) &&
    (loadSpeed === null || loadSpeed <= 3.5) &&
    (hasPixel || hasGtm || hasGoogleAds)

  if (recentPerformantSite) {
    score += 25
    evidence.push({ label: 'Sito recente/performante', value: `freshness ${Math.round(freshness)}/100`, source: 'website_audit' })
  }

  if (score < 30 || evidence.length === 0) return null

  const severity = score >= 55 ? 'high' : 'medium'
  const confidence = Math.min(95, 55 + score)

  return {
    id: 'intent_marketing_spend',
    kind: 'intent',
    signalType: 'intent_marketing_spend',
    title: 'Sta investendo in marketing',
    severity,
    confidence,
    reason: 'Combinazione di segnali pubblicitari e presenza digitale attiva indica budget marketing in corso o recente.',
    evidence,
    serviceToSell: 'Ottimizzazione ROI marketing, audit campagne e conversioni',
    openingLine: `${name} mostra segnali di investimento in marketing digitale: possiamo analizzare dove migliorare resa e costo per contatto.`,
    nextBestAction: 'Proponi audit performance marketing con dati verificabili.',
    detectedAt: new Date().toISOString(),
  }
}
