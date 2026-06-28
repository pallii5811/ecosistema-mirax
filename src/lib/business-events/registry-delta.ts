import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readNumber, readString } from '@/lib/business-events/types'

type BilancioRow = { anno?: number; fatturato?: number; dipendenti?: number; utile?: number }

function readStoricoBilanci(lead: Record<string, unknown>): BilancioRow[] {
  const openapi = asRecord(lead.openapi_enriched ?? lead.openapi ?? lead.registry_data)
  const storico = openapi.storico_bilanci ?? lead.storico_bilanci
  if (!Array.isArray(storico)) return []
  return storico
    .filter((r) => r && typeof r === 'object')
    .map((r) => r as BilancioRow)
    .filter((r) => typeof r.anno === 'number')
    .sort((a, b) => (b.anno ?? 0) - (a.anno ?? 0))
}

function pctGrowth(prev: number, next: number): number | null {
  if (prev <= 0 || next <= 0) return null
  return Math.round(((next - prev) / prev) * 100)
}

/** Variazioni registro da dati OpenAPI già nel lead o storico bilanci. */
export function detectRegistrySignals(lead: Record<string, unknown>): MiraxSignal[] {
  const signals: MiraxSignal[] = []
  const piva = readString(lead, ['partita_iva', 'piva', 'vat', 'vat_number'])
  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const employees = readNumber(lead, ['dipendenti', 'employees', 'dipendenti_stimati'])
  const revenue = readNumber(lead, ['fatturato', 'revenue'])
  const storico = readStoricoBilanci(lead)

  if (storico.length >= 2) {
    const [latest, prev] = storico
    const empGrowth =
      typeof latest.dipendenti === 'number' && typeof prev.dipendenti === 'number'
        ? pctGrowth(prev.dipendenti, latest.dipendenti)
        : null
    const revGrowth =
      typeof latest.fatturato === 'number' && typeof prev.fatturato === 'number'
        ? pctGrowth(prev.fatturato, latest.fatturato)
        : null

    if (empGrowth !== null && empGrowth >= 15) {
      signals.push({
        id: 'registry_employees_growth',
        kind: 'business',
        signalType: 'registry_change',
        title: 'Crescita dipendenti in registro — azienda in espansione',
        severity: empGrowth >= 30 ? 'high' : 'medium',
        confidence: 88,
        reason: 'Lo storico bilanci da Camera di Commercio mostra aumento del personale rispetto all’anno precedente.',
        evidence: [
          { label: 'Dipendenti anno precedente', value: String(prev.dipendenti), source: 'openapi_it' },
          { label: 'Dipendenti ultimo anno', value: String(latest.dipendenti), source: 'openapi_it' },
          { label: 'Variazione', value: `+${empGrowth}%`, source: 'openapi_it' },
          ...(piva ? [{ label: 'P.IVA', value: piva, source: 'openapi_it' }] : []),
        ],
        serviceToSell: 'Lead generation, CRM e automazioni per team in crescita',
        openingLine: `${name} risulta in crescita (+${empGrowth}% dipendenti nell’ultimo bilancio): spesso è il momento giusto per strutturare acquisizione clienti e processi commerciali.`,
        nextBestAction: 'Contatta con angolo “supporto alla crescita commerciale”.',
        detectedAt: new Date().toISOString(),
      })
    }

    if (revGrowth !== null && revGrowth >= 20) {
      signals.push({
        id: 'registry_revenue_growth',
        kind: 'business',
        signalType: 'registry_change',
        title: 'Fatturato in crescita — budget disponibile probabile',
        severity: revGrowth >= 40 ? 'high' : 'medium',
        confidence: 86,
        reason: 'Incremento fatturato registrato nello storico bilanci ufficiale.',
        evidence: [
          { label: 'Fatturato anno precedente', value: `€ ${prev.fatturato?.toLocaleString('it-IT')}`, source: 'openapi_it' },
          { label: 'Fatturato ultimo anno', value: `€ ${latest.fatturato?.toLocaleString('it-IT')}`, source: 'openapi_it' },
          { label: 'Variazione', value: `+${revGrowth}%`, source: 'openapi_it' },
        ],
        serviceToSell: 'Marketing performance, campagne e misurazione ROI',
        openingLine: `Vedo che ${name} ha fatto registrare una crescita del fatturato del ${revGrowth}%: è spesso il momento in cui le aziende investono di più in marketing strutturato.`,
        nextBestAction: 'Proponi piano marketing con ROI misurabile.',
        detectedAt: new Date().toISOString(),
      })
    }
  } else if (employees !== null && employees >= 10 && revenue !== null && revenue >= 500_000) {
    signals.push({
      id: 'registry_structured_company',
      kind: 'business',
      signalType: 'registry_change',
      title: 'Azienda strutturata in registro — target B2B qualificato',
      severity: 'medium',
      confidence: 72,
      reason: 'Dati registro indicano realtà con dimensioni significative.',
      evidence: [
        ...(piva ? [{ label: 'P.IVA', value: piva, source: 'openapi_it' }] : []),
        { label: 'Dipendenti', value: String(employees), source: 'openapi_it' },
        { label: 'Fatturato indicativo', value: `€ ${revenue.toLocaleString('it-IT')}`, source: 'openapi_it' },
      ],
      serviceToSell: 'Consulenza marketing B2B e acquisizione lead qualificati',
      openingLine: `${name} risulta una realtà strutturata in registro: possiamo valutare insieme come rendere più misurabile l’acquisizione clienti.`,
      nextBestAction: 'Qualifica budget e processo commerciale attuale.',
      detectedAt: new Date().toISOString(),
    })
  }

  return signals
}
