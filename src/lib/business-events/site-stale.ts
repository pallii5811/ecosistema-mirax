import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readNumber, readString } from '@/lib/business-events/types'
import { computeFreshnessScore } from '@/lib/lead-object'

const CURRENT_YEAR = new Date().getFullYear()

function extractCopyrightYear(lead: Record<string, unknown>): number | null {
  const tr = asRecord(lead.technical_report)
  const direct = readNumber(tr, ['copyright_year', 'footer_copyright_year'])
  if (direct !== null && direct >= 1990 && direct <= CURRENT_YEAR + 1) return direct

  const htmlSnippet = readString(tr, ['html_snippet', 'footer_text', 'page_text_sample'])
  if (!htmlSnippet) return null
  const match = htmlSnippet.match(/(?:©|copyright|\(c\))\s*(\d{4})/i) || htmlSnippet.match(/\b(20\d{2})\b/g)
  if (!match) return null
  const year = Number(Array.isArray(match) ? match[match.length - 1] : match[1])
  return Number.isFinite(year) && year >= 1990 && year <= CURRENT_YEAR + 1 ? year : null
}

/** Segnali sito datato/lento da dati audit già presenti nel lead. */
export function detectSiteStaleSignals(lead: Record<string, unknown>): MiraxSignal[] {
  const signals: MiraxSignal[] = []
  const website = readString(lead, ['sito', 'website', 'url'])
  if (!website) return signals

  const tr = asRecord(lead.technical_report)
  const name = readString(lead, ['azienda', 'nome', 'business_name', 'company', 'name']) || 'questa azienda'
  const freshness =
    typeof lead.freshness_score === 'number' && Number.isFinite(lead.freshness_score)
      ? Math.round(lead.freshness_score)
      : computeFreshnessScore(lead.last_audited_at)
  const loadSpeed =
    readNumber(lead, ['load_speed_seconds', 'load_speed_s']) ??
    readNumber(tr, ['load_speed_seconds', 'load_speed_s'])
  const copyrightYear = extractCopyrightYear(lead)
  const lastAudited = readString(lead, ['last_audited_at'])

  if (copyrightYear !== null && copyrightYear <= CURRENT_YEAR - 2) {
    signals.push({
      id: 'site_stale_copyright',
      kind: 'business',
      signalType: 'site_stale',
      title: 'Sito con copyright datato — possibile manutenzione trascurata',
      severity: copyrightYear <= CURRENT_YEAR - 4 ? 'high' : 'medium',
      confidence: 82,
      reason: `Il footer del sito riporta copyright ${copyrightYear}: spesso indica assenza di aggiornamenti recenti.`,
      evidence: [
        { label: 'Anno copyright footer', value: String(copyrightYear), source: 'website_audit' },
        { label: 'Sito', value: website, source: 'lead_data' },
      ],
      serviceToSell: 'Restyling sito, manutenzione web e ottimizzazione conversioni',
      openingLine: `Ho notato che il sito di ${name} riporta ancora copyright ${copyrightYear}: spesso è il segnale di un sito non aggiornato da tempo. Posso mostrarvi cosa migliorare per convertire più visitatori.`,
      nextBestAction: 'Proponi audit gratuito sito + restyling mirato.',
      detectedAt: lastAudited || undefined,
    })
  }

  if (loadSpeed !== null && loadSpeed >= 4.5) {
    signals.push({
      id: 'site_stale_slow',
      kind: 'business',
      signalType: 'site_stale',
      title: 'Sito lento — segnale di manutenzione insufficiente',
      severity: loadSpeed >= 6 ? 'high' : 'medium',
      confidence: 78,
      reason: 'Un sito molto lento suggerisce infrastruttura o manutenzione non recente.',
      evidence: [
        { label: 'Velocità caricamento', value: `${loadSpeed.toFixed(1)} secondi`, source: 'website_audit' },
        { label: 'Soglia consigliata', value: '< 2.5s (Google Core Web Vitals)', source: 'website_audit' },
      ],
      serviceToSell: 'Ottimizzazione performance e manutenzione web',
      openingLine: `Il sito di ${name} carica in circa ${loadSpeed.toFixed(1)} secondi: oltre la soglia Google. Velocizzarlo può aumentare le richieste senza spendere di più in marketing.`,
      nextBestAction: 'Mostra il dato PageSpeed e proponi fix performance.',
      detectedAt: lastAudited || undefined,
    })
  }

  if (freshness > 0 && freshness <= 25) {
    signals.push({
      id: 'site_stale_audit_age',
      kind: 'business',
      signalType: 'site_stale',
      title: 'Presenza online datata — rivalutazione consigliata',
      severity: freshness <= 10 ? 'high' : 'medium',
      confidence: 70,
      reason: 'L’ultimo audit tecnico indica che il sito non è stato rivalutato di recente.',
      evidence: [
        { label: 'Freshness score', value: `${freshness}/100`, source: 'website_audit' },
        ...(lastAudited ? [{ label: 'Ultimo audit', value: lastAudited.slice(0, 10), source: 'website_audit' }] : []),
      ],
      serviceToSell: 'Audit sito + piano di aggiornamento digitale',
      openingLine: `${name} ha un sito che non risulta aggiornato di recente: prima di investire in acquisizione conviene verificare che la presenza online sia all’altezza.`,
      nextBestAction: 'Proponi audit tecnico-commerciale aggiornato.',
      detectedAt: lastAudited || undefined,
    })
  }

  return signals
}

/** HEAD request opzionale per Last-Modified (route API refresh). */
export async function fetchSiteLastModified(url: string): Promise<Date | null> {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url.replace(/^\/\//, '')}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(normalized, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'MIRAX-BusinessEvents/1.0 (+https://miraxgroup.it)' },
    })
    clearTimeout(timer)
    const lm = res.headers.get('last-modified')
    if (!lm) return null
    const d = new Date(lm)
    return Number.isFinite(d.getTime()) ? d : null
  } catch {
    return null
  }
}

export async function detectSiteStaleFromHeaders(lead: Record<string, unknown>): Promise<MiraxSignal[]> {
  const website = readString(lead, ['sito', 'website', 'url'])
  if (!website) return []
  const lastMod = await fetchSiteLastModified(website)
  if (!lastMod) return []

  const ageDays = Math.floor((Date.now() - lastMod.getTime()) / 86_400_000)
  if (ageDays < 365) return []

  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  return [{
    id: 'site_stale_last_modified',
    kind: 'business',
    signalType: 'site_stale',
    title: 'Sito non aggiornato da oltre un anno (Last-Modified)',
    severity: ageDays >= 730 ? 'high' : 'medium',
    confidence: 85,
    reason: 'L’header HTTP Last-Modified indica che il contenuto non è stato aggiornato di recente.',
    evidence: [
      { label: 'Last-Modified', value: lastMod.toISOString().slice(0, 10), source: 'website_audit', url: website },
      { label: 'Giorni dall’ultimo aggiornamento', value: String(ageDays), source: 'website_audit' },
    ],
    serviceToSell: 'Restyling sito e content update',
    openingLine: `Dal controllo tecnico del sito di ${name} risulta un ultimo aggiornamento di oltre ${Math.round(ageDays / 30)} mesi fa: possiamo valutare un refresh mirato.`,
    nextBestAction: 'Proponi restyling o landing aggiornata.',
    detectedAt: lastMod.toISOString(),
  }]
}
