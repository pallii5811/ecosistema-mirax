/**
 * Segnale "sta investendo in marketing" — solo evidenza verificabile (Meta Ad Library).
 * Pixel/GTM/tag sono criticità tecniche, non segnali d'acquisto.
 */

import type { MiraxSignal } from '@/lib/mirax-signals'
import { readString } from '@/lib/business-events/types'
import {
  hasVerifiedMarketingAdSpend,
  verifiedMetaAdCount,
} from '@/lib/signal-intent/marketing-investment'

export function detectIntentMarketingSpend(lead: Record<string, unknown>): MiraxSignal | null {
  if (!hasVerifiedMarketingAdSpend(lead)) return null

  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const count = verifiedMetaAdCount(lead)

  return {
    id: 'intent_marketing_spend',
    kind: 'intent',
    signalType: 'intent_marketing_spend',
    title: 'Sta investendo in pubblicità Meta',
    severity: 'high',
    confidence: 94,
    reason: 'La Meta Ad Library conferma inserzioni attive — budget ads in corso.',
    evidence: [
      {
        label: 'Inserzioni Meta attive',
        value: String(count ?? 'sì'),
        source: 'meta_ad_library',
        url: typeof lead.meta_ad_library_url === 'string' ? lead.meta_ad_library_url : undefined,
      },
    ],
    serviceToSell: 'Ottimizzazione campagne Meta, creatività e scaling ROAS',
    openingLine: `${name} ha inserzioni attive su Meta: possiamo analizzare dove migliorare resa e costo per contatto.`,
    nextBestAction: 'Mini-audit campagne con prova Ad Library.',
    detectedAt: new Date().toISOString(),
  }
}
