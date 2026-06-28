/**
 * Eventi NOUS — envelope standard per Zapier/Make/webhook enterprise.
 */

export const NOUS_EVENTS = {
  LEAD_EXPORTED: 'lead.exported',
  LEADS_EXPORTED: 'leads.exported',
  PIPELINE_STAGE_CHANGED: 'pipeline.stage_changed',
  PIPELINE_WON: 'pipeline.won',
  PIPELINE_LOST: 'pipeline.lost',
  OUTREACH_LOGGED: 'outreach.logged',
  LEAD_CHANGE_DETECTED: 'lead.change_detected',
  LEAD_REAUDITED: 'lead.reaudited',
  OUTREACH_SENT: 'outreach.sent',
  SEQUENCE_EMAIL_SENT: 'sequence.email_sent',
} as const

export type NousEventType = (typeof NOUS_EVENTS)[keyof typeof NOUS_EVENTS] | string

export type NousEnvelope = {
  event: string
  version: '1.0'
  timestamp: string
  source: 'mirax'
  count?: number
  lead?: Record<string, unknown>
  leads?: Record<string, unknown>[]
  payload?: Record<string, unknown>
}

export function leadToWebhookRecord(lead: {
  nome: string
  sito: string
  email: string
  telefono: string
  citta: string
  categoria: string
  score: number
  opportunita: { no_pixel: boolean; no_gtm: boolean; errori_seo: number }
}): Record<string, unknown> {
  return {
    nome: lead.nome,
    sito: lead.sito,
    email: lead.email,
    telefono: lead.telefono,
    citta: lead.citta,
    categoria: lead.categoria,
    score: lead.score,
    opportunita: lead.opportunita,
  }
}

export function buildNousEnvelope(
  event: string,
  input: { leads?: Array<Parameters<typeof leadToWebhookRecord>[0]>; payload?: Record<string, unknown> },
): NousEnvelope {
  const leads = input.leads ?? []
  const base: NousEnvelope = {
    event,
    version: '1.0',
    timestamp: new Date().toISOString(),
    source: 'mirax',
  }

  if (leads.length === 1 && event === NOUS_EVENTS.LEAD_EXPORTED) {
    return { ...base, lead: leadToWebhookRecord(leads[0]) }
  }

  if (leads.length > 0) {
    return {
      ...base,
      count: leads.length,
      leads: leads.map(leadToWebhookRecord),
    }
  }

  return { ...base, payload: input.payload ?? {} }
}

/** Mappa eventi mirax_events → eventi NOUS webhook. */
export function mapMiraxEventToNous(eventType: string): string {
  const map: Record<string, string> = {
    'lead.change_detected': NOUS_EVENTS.LEAD_CHANGE_DETECTED,
    'lead.reaudited': NOUS_EVENTS.LEAD_REAUDITED,
    'outreach.sent': NOUS_EVENTS.OUTREACH_LOGGED,
    'sequence.email_sent': NOUS_EVENTS.SEQUENCE_EMAIL_SENT,
    'pipeline.stage_changed': NOUS_EVENTS.PIPELINE_STAGE_CHANGED,
    'pipeline.won': NOUS_EVENTS.PIPELINE_WON,
    'pipeline.lost': NOUS_EVENTS.PIPELINE_LOST,
  }
  return map[eventType] ?? eventType
}

export function integrationSubscribesToEvent(
  config: Record<string, unknown>,
  event: string,
): boolean {
  const events = config.events
  if (!Array.isArray(events) || events.length === 0) return true
  return events.some((e) => String(e) === event)
}
