import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readString } from '@/lib/business-events/types'

const DEFAULT_SECTOR_TERMS = [
  'fotovoltaico',
  'fotovoltaica',
  'pannelli solari',
  'impianti solari',
  'rinnovabili',
  'energia solare',
]

function haystack(lead: Record<string, unknown>): string {
  const tr = asRecord(lead.technical_report)
  const hits = lead.business_sector_hits
  const hitText = Array.isArray(hits)
    ? hits.map((h) => (h && typeof h === 'object' ? String((h as Record<string, unknown>).snippet || '') : '')).join(' ')
    : ''
  return [
    readString(lead, ['categoria', 'category']),
    readString(lead, ['descrizione', 'description']),
    hitText,
    JSON.stringify(tr).slice(0, 4000),
  ]
    .join(' ')
    .toLowerCase()
}

export function detectSectorInvestmentSignals(
  lead: Record<string, unknown>,
  keywords: string[] = [],
): MiraxSignal[] {
  const autoHits = lead.business_sector_hits
  if (Array.isArray(autoHits) && autoHits.length > 0) {
    const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
    const matched = autoHits
      .map((h) => String((h as Record<string, unknown>).keyword || '').trim())
      .filter(Boolean)
    return [
      {
        id: `sector_${matched[0]?.replace(/\s+/g, '_') || 'hit'}`,
        kind: 'business',
        signalType: 'sector_investment',
        title: `Investimento settore — ${matched.slice(0, 2).join(', ')}`,
        severity: 'high',
        confidence: 80,
        reason: 'Enrichment worker: evidenze settoriali sul sito o nella categoria.',
        evidence: autoHits.slice(0, 4).map((h, i) => ({
          label: `Evidenza ${i + 1}`,
          value: String((h as Record<string, unknown>).snippet || (h as Record<string, unknown>).keyword || ''),
          source: 'website_content',
        })),
        serviceToSell: 'Consulenza verticale sul settore',
        openingLine: `${name} mostra segnali in ambito ${matched[0]}.`,
        nextBestAction: 'Approfondisci il progetto settoriale in call.',
        detectedAt: new Date().toISOString(),
      },
    ]
  }

  const terms = [...keywords]
  const searchTerms = [
    ...new Set([
      ...terms,
      ...DEFAULT_SECTOR_TERMS.filter((t) => keywords.some((k) => t.includes(k) || k.includes(t.split(' ')[0]))),
    ]),
  ]
  if (!searchTerms.length && keywords.length) searchTerms.push(...keywords)

  const text = haystack(lead)
  if (!text.trim()) return []

  const matched: string[] = []
  for (const term of searchTerms) {
    const t = term.toLowerCase().trim()
    if (t && text.includes(t)) matched.push(term)
  }

  if (!matched.length && keywords.length) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) matched.push(kw)
    }
  }

  if (!matched.length) return []

  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  return [
    {
      id: `sector_${matched[0].replace(/\s+/g, '_')}`,
      kind: 'business',
      signalType: 'sector_investment',
      title: `Investimento settore — ${matched.slice(0, 2).join(', ')}`,
      severity: 'high',
      confidence: 78,
      reason: 'Evidenze testuali sul sito o nei dati enrichment coerenti con il tema richiesto.',
      evidence: matched.slice(0, 4).map((m) => ({ label: 'Tema', value: m, source: 'website_content' })),
      serviceToSell: 'Consulenza verticale sul settore + acquisizione lead qualificati',
      openingLine: `${name} mostra segnali legati a ${matched[0]}: possiamo approfondire opportunità commerciali in questo ambito.`,
      nextBestAction: 'Apri con domanda specifica sul progetto/settore.',
      detectedAt: new Date().toISOString(),
    },
  ]
}
