import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readString } from '@/lib/business-events/types'

const CRM_PATTERNS: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  { id: 'hubspot', label: 'HubSpot', patterns: [/\bhubspot\b/i, /js\.hs-scripts\.com/i, /hsforms\.net/i] },
  { id: 'salesforce', label: 'Salesforce', patterns: [/\bsalesforce\b/i, /force\.com/i, /pardot\.com/i] },
  { id: 'pipedrive', label: 'Pipedrive', patterns: [/\bpipedrive\b/i, /pipedriveassets\.com/i] },
  { id: 'zoho', label: 'Zoho CRM', patterns: [/\bzoho\b/i, /zohopublic\.com/i, /zcrm/i] },
  { id: 'dynamics', label: 'Microsoft Dynamics', patterns: [/\bdynamics\s*365\b/i, /dynamics\.com/i] },
  { id: 'freshsales', label: 'Freshsales', patterns: [/\bfreshsales\b/i, /freshworks\.com/i] },
]

function textBlob(lead: Record<string, unknown>): string {
  const tr = asRecord(lead.technical_report)
  const parts = [
    readString(lead, ['sito', 'website']),
    JSON.stringify(tr),
    JSON.stringify(lead.detected_crm_stack),
    JSON.stringify(lead.tech_stack),
  ]
  return parts.join(' ').toLowerCase()
}

export function detectCrmFromText(text: string): string[] {
  const found: string[] = []
  for (const crm of CRM_PATTERNS) {
    if (crm.patterns.some((p) => p.test(text))) found.push(crm.label)
  }
  return [...new Set(found)]
}

export function detectCrmStackSignals(lead: Record<string, unknown>): MiraxSignal[] {
  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const stackRaw = lead.detected_crm_stack
  const fromField = Array.isArray(stackRaw) ? stackRaw.map(String).filter(Boolean) : []
  const fromText = detectCrmFromText(textBlob(lead))
  const crms = [...new Set([...fromField, ...fromText])]
  if (!crms.length) return []

  return [
    {
      id: 'crm_stack_detected',
      kind: 'business',
      signalType: 'crm_detected',
      title: `CRM rilevato — ${crms.slice(0, 2).join(', ')}`,
      severity: 'medium',
      confidence: 85,
      reason: 'Script o riferimenti a piattaforme CRM trovati sul sito o nei dati enrichment.',
      evidence: crms.map((c) => ({ label: 'CRM', value: c, source: 'website_audit' })),
      serviceToSell: 'Integrazione CRM, migrazione dati e automazioni commerciali',
      openingLine: `${name} usa ${crms[0]}: possiamo verificare se il setup converte lead e pipeline in modo efficiente.`,
      nextBestAction: 'Proponi audit CRM + automazioni.',
      detectedAt: new Date().toISOString(),
    },
  ]
}

export function detectCrmChangeSignals(lead: Record<string, unknown>): MiraxSignal[] {
  const changes = lead.audit_changes
  if (!Array.isArray(changes)) return []
  const crmChanges = changes.filter(
    (c) =>
      c &&
      typeof c === 'object' &&
      String((c as Record<string, unknown>).field || '').toLowerCase().includes('crm'),
  )
  if (!crmChanges.length) return []

  const name = readString(lead, ['azienda', 'nome', 'name']) || 'questa azienda'
  const latest = crmChanges[0] as Record<string, unknown>
  return [
    {
      id: 'crm_stack_change',
      kind: 'business',
      signalType: 'crm_change',
      title: 'Cambio stack CRM rilevato',
      severity: 'high',
      confidence: 88,
      reason: String(latest.signal || 'Variazione CRM rispetto audit precedente.'),
      evidence: [
        {
          label: 'Dettaglio',
          value: String(latest.signal || latest.label || 'CRM change'),
          source: 'audit_delta',
        },
      ],
      serviceToSell: 'Migrazione CRM, training team e integrazione marketing',
      openingLine: `${name} ha recentemente cambiato CRM: è il momento ideale per supporto integrazione e processi.`,
      nextBestAction: 'Contatta entro 30 giorni dal cambio.',
      detectedAt: String(latest.detected_at || new Date().toISOString()),
    },
  ]
}
