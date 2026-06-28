/** Tipi evento EDAT lite — event bus interno `mirax_events`. */
export const MIRAX_EVENT_TYPES = [
  'lead.monitored',
  'lead.reaudited',
  'lead.change_detected',
  'outreach.sent',
  'sequence.email_sent',
  'sequence.run_completed',
] as const

export type MiraxEventType = (typeof MIRAX_EVENT_TYPES)[number]

export type LeadChange = {
  field: string
  label: string
  from: unknown
  to: unknown
  detected_at: string
  signal: string
}

export type MiraxEventPayload = Record<string, unknown>

export function isMiraxEventType(v: unknown): v is MiraxEventType {
  return typeof v === 'string' && (MIRAX_EVENT_TYPES as readonly string[]).includes(v)
}
