/**
 * Fase 11 — CRM Hub core (testabile da Node senza alias @/).
 */

export type CrmProvider = 'hubspot' | 'pipedrive' | 'salesforce'

export type CrmSyncSettings = {
  auto_sync_hot_leads: boolean
  auto_create_deals: boolean
  field_mapping?: Record<string, string>
}

export type MiraxCrmPayload = {
  intentScore: number
  signalTypes: string[]
  signalSummary: string
  lastSignalDate: string
}

export function shouldAutoSyncLead(intentScore: number, settings: CrmSyncSettings): boolean {
  return settings.auto_sync_hot_leads && intentScore >= 60
}

export function shouldAutoCreateDeal(intentScore: number, settings: CrmSyncSettings): boolean {
  return settings.auto_create_deals && intentScore >= 80
}

export function extractSignalTypes(lead: Record<string, unknown>): string[] {
  const out = new Set<string>()
  const bs = lead.business_signals
  if (Array.isArray(bs)) {
    for (const s of bs) {
      if (s && typeof s === 'object') {
        const t = String((s as Record<string, unknown>).type || (s as Record<string, unknown>).signal_type || '').trim()
        if (t) out.add(t)
      }
    }
  }
  return [...out]
}

export function buildMiraxCrmPayload(lead: Record<string, unknown>, intentScore: number): MiraxCrmPayload {
  const signals = Array.isArray(lead.business_signals)
    ? (lead.business_signals as Record<string, unknown>[])
    : []
  const signalTypes = extractSignalTypes(lead)
  const signalSummary = signals
    .slice(0, 5)
    .map((s) => String(s.title || s.type || '').trim())
    .filter(Boolean)
    .join('; ')

  return {
    intentScore,
    signalTypes,
    signalSummary: signalSummary || signalTypes.join(', '),
    lastSignalDate: new Date().toISOString().slice(0, 10),
  }
}

export function hubspotPropertiesFromMirax(
  lead: Record<string, unknown>,
  payload: MiraxCrmPayload,
  fieldMapping: Record<string, string> = {},
): Record<string, string> {
  const nome = String(lead.nome || lead.azienda || lead.name || '').trim()
  const email = String(lead.email || '').trim().toLowerCase()
  const base: Record<string, string> = {
    company: nome,
    website: String(lead.sito || lead.website || '').trim(),
    phone: String(lead.telefono || lead.phone || '').trim(),
    city: String(lead.citta || lead.city || '').trim(),
    hs_lead_status: payload.intentScore >= 80 ? 'OPEN' : 'NEW',
    description: `MIRAX Intent ${payload.intentScore}/100 — Segnali: ${payload.signalSummary || 'in analisi'}`,
  }
  if (email) base.email = email

  const miraxCustom: Record<string, string> = {
    mirax_intent_score: String(payload.intentScore),
    mirax_signals: payload.signalSummary,
    mirax_source: 'mirax',
    mirax_last_signal_date: payload.lastSignalDate,
  }

  for (const [miraxKey, hubspotKey] of Object.entries(fieldMapping)) {
    if (miraxCustom[miraxKey] && hubspotKey) {
      base[hubspotKey] = miraxCustom[miraxKey]
    }
  }

  for (const [k, v] of Object.entries(miraxCustom)) {
    if (!Object.values(fieldMapping).includes(k)) {
      base[k] = v
    }
  }

  return base
}

export function leadSyncDedupeKey(lead: Record<string, unknown>): string {
  const email = String(lead.email || '').trim().toLowerCase()
  if (email) return `email:${email}`
  const site = String(lead.sito || lead.website || '').trim().toLowerCase()
  if (site) return `site:${site}`
  return `name:${String(lead.nome || lead.azienda || '').trim().toLowerCase()}`
}
