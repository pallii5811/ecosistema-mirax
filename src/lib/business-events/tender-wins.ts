import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readString } from '@/lib/business-events/types'

function parseHitDate(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const d = Date.parse(raw)
  return Number.isFinite(d) ? d : null
}

export function detectTenderWinSignals(
  lead: Record<string, unknown>,
  timeWindowDays: number | null = 365,
): MiraxSignal[] {
  const hits = lead.business_tender_hits
  if (!Array.isArray(hits) || hits.length === 0) return []

  const cutoff =
    timeWindowDays && timeWindowDays > 0 ? Date.now() - timeWindowDays * 86400000 : null

  const valid = hits.filter((h) => {
    if (!h || typeof h !== 'object') return false
    const row = h as Record<string, unknown>
    const title = String(row.title || row.snippet || '').trim()
    if (!title) return false
    if (!cutoff) return true
    const d = parseHitDate(row.date)
    return d === null || d >= cutoff
  })

  if (!valid.length) return []

  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const first = valid[0] as Record<string, unknown>
  const title = String(first.title || first.snippet || 'Gara / appalto')

  return [
    {
      id: 'tender_won_public',
      kind: 'business',
      signalType: 'tender_won',
      title: 'Gara / appalto pubblico rilevato',
      severity: 'high',
      confidence: 82,
      reason: 'Fonti web pubbliche indicano aggiudicazione o partecipazione a gara.',
      evidence: valid.slice(0, 3).map((h, i) => {
        const row = h as Record<string, unknown>
        return {
          label: `Evidenza ${i + 1}`,
          value: String(row.title || row.snippet || '').slice(0, 120),
          source: 'public_web',
          url: typeof row.url === 'string' ? row.url : undefined,
        }
      }),
      serviceToSell: 'Supporto post-gara: fornitura, subappalto, servizi correlati',
      openingLine: `${name} risulta collegata a "${title.slice(0, 80)}": possiamo valutare sinergie commerciali.`,
      nextBestAction: 'Contatta con riferimento specifico alla gara.',
      detectedAt: String(first.date || new Date().toISOString()),
    },
  ]
}
