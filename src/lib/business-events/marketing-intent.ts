import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readNumber, readString } from '@/lib/business-events/types'

function readBoolFromLead(lead: Record<string, unknown>, keys: string[]): boolean | null {
  const tr = asRecord(lead.technical_report)
  const audit = asRecord(lead.audit)
  for (const obj of [lead, tr, audit]) {
    for (const key of keys) {
      const value = obj[key]
      if (value === true) return true
      if (value === false) return false
    }
  }
  return null
}

/** Segnale hiring da crescita organico (Indeed worker-side in backlog PR-3). */
export function detectHiringSignals(lead: Record<string, unknown>): MiraxSignal[] {
  const signals: MiraxSignal[] = []
  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const employees = readNumber(lead, ['dipendenti', 'employees', 'dipendenti_stimati'])
  const piva = readString(lead, ['partita_iva', 'piva'])

  // Worker-side Indeed jobs (future): lead.business_hiring_jobs
  const hiringJobs = lead.business_hiring_jobs
  if (Array.isArray(hiringJobs) && hiringJobs.length > 0) {
    const titles = hiringJobs
      .slice(0, 3)
      .map((j) => (j && typeof j === 'object' ? String((j as Record<string, unknown>).title || '') : ''))
      .filter(Boolean)
    if (titles.length > 0) {
      signals.push({
        id: 'hiring_indeed_jobs',
        kind: 'business',
        signalType: 'hiring',
        title: 'Assunzioni in corso — offerte di lavoro rilevate',
        severity: 'high',
        confidence: 90,
        reason: 'Offerte di lavoro pubbliche indicano espansione del team.',
        evidence: titles.map((t, i) => ({
          label: `Offerta ${i + 1}`,
          value: t,
          source: 'indeed_scrape',
        })),
        serviceToSell: 'Servizi HR marketing, employer branding e lead gen B2B',
        openingLine: `${name} sta assumendo (${titles[0]}): spesso è il segnale di crescita e nuovi budget operativi.`,
        nextBestAction: 'Contatta con proposta legata alla fase di espansione.',
        detectedAt: new Date().toISOString(),
      })
      return signals
    }
  }

  if (employees !== null && employees >= 15) {
    signals.push({
      id: 'hiring_organic_growth',
      kind: 'business',
      signalType: 'hiring',
      title: 'Team strutturato — probabile fase di crescita',
      severity: employees >= 50 ? 'high' : 'medium',
      confidence: 65,
      reason: 'Dimensione del personale da registro suggerisce organizzazione in espansione.',
      evidence: [
        { label: 'Dipendenti stimati', value: String(employees), source: 'openapi_it' },
        ...(piva ? [{ label: 'P.IVA', value: piva, source: 'openapi_it' }] : []),
      ],
      serviceToSell: 'Automazione commerciale e onboarding clienti scalabile',
      openingLine: `${name} ha un team di ${employees} persone: in fase di crescita spesso serve strutturare acquisizione e processi digitali.`,
      nextBestAction: 'Qualifica pain point operativi legati alla crescita.',
      detectedAt: new Date().toISOString(),
    })
  }

  return signals
}

/** Intent marketing: Meta Ads + Google Ads da audit lead. */
export function detectMarketingIntentSignals(lead: Record<string, unknown>): MiraxSignal[] {
  const signals: MiraxSignal[] = []
  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const tr = asRecord(lead.technical_report)

  const activeMetaAds = readNumber(tr, ['active_meta_ads', 'meta_ads_count']) ?? readNumber(lead, ['active_meta_ads'])
  const metaVerified = readBoolFromLead(lead, ['meta_ads_verified']) === true || tr.meta_ads_verified === true
  const hasGoogleAds =
    readBoolFromLead(lead, ['google_ads', 'has_google_ads']) === true || tr.has_google_ads === true

  if (metaVerified && activeMetaAds !== null && activeMetaAds > 0) {
    signals.push({
      id: 'meta_ads_started',
      kind: 'business',
      signalType: 'meta_ads_started',
      title: 'Inserzioni Meta attive — investimento marketing in corso',
      severity: 'high',
      confidence: 94,
      reason: 'La Meta Ad Library conferma campagne pubblicitarie attive.',
      evidence: [
        { label: 'Inserzioni attive', value: String(activeMetaAds), source: 'meta_ad_library' },
      ],
      serviceToSell: 'Gestione campagne Meta, creatività e ottimizzazione ROAS',
      openingLine: `${name} ha ${activeMetaAds} inserzion${activeMetaAds === 1 ? 'e' : 'i'} attive su Meta: posso analizzare dove migliorare resa e costo per contatto.`,
      nextBestAction: 'Mini-audit campagne con prova Ad Library.',
      detectedAt: new Date().toISOString(),
    })
  }

  if (hasGoogleAds) {
    signals.push({
      id: 'google_ads_started',
      kind: 'business',
      signalType: 'google_ads_started',
      title: 'Google Ads rilevato — budget search/display attivo',
      severity: 'high',
      confidence: 80,
      reason: 'Tag o script Google Ads presente sul sito.',
      evidence: [
        { label: 'Google Ads', value: 'tag rilevato sul sito', source: 'website_audit' },
      ],
      serviceToSell: 'Audit Google Ads, tracking conversioni e ottimizzazione keyword',
      openingLine: `${name} investe già in Google Ads: possiamo verificare se il tracking e le landing convertono al massimo.`,
      nextBestAction: 'Proponi audit tracking + landing.',
      detectedAt: new Date().toISOString(),
    })
  }

  return signals
}
