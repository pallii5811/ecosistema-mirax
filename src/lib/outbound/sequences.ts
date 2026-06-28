/**
 * Fase 9.1 — Sequenze outbound triggerate da segnali (manifesto v3.0).
 */

export type SequenceStep = {
  day: number
  action: 'email' | 'linkedin'
  template: string
}

export type SequenceTrigger = {
  signal_type?: string
  min_intent_score?: number
}

export type OutboundSequence = {
  key: string
  label: string
  trigger: SequenceTrigger
  steps: SequenceStep[]
}

export const OUTBOUND_SEQUENCES: Record<string, OutboundSequence> = {
  hiring_play: {
    key: 'hiring_play',
    label: 'Play Assunzioni',
    trigger: { signal_type: 'hiring', min_intent_score: 50 },
    steps: [
      { day: 0, action: 'email', template: 'hiring_intro' },
      { day: 3, action: 'email', template: 'hiring_followup' },
      { day: 7, action: 'linkedin', template: 'hiring_social' },
    ],
  },
  tender_play: {
    key: 'tender_play',
    label: 'Play Gara Vinta',
    trigger: { signal_type: 'tender_won', min_intent_score: 60 },
    steps: [
      { day: 0, action: 'email', template: 'tender_congrats' },
      { day: 2, action: 'email', template: 'tender_offer' },
    ],
  },
  hot_lead_play: {
    key: 'hot_lead_play',
    label: 'Play Hot Lead',
    trigger: { min_intent_score: 80 },
    steps: [{ day: 0, action: 'email', template: 'hot_lead_personal' }],
  },
}

export type LeadSignalSnapshot = {
  signalTypes: string[]
  intentScore: number
}

export function matchOutboundSequence(snapshot: LeadSignalSnapshot): OutboundSequence | null {
  const types = new Set(snapshot.signalTypes)
  const score = snapshot.intentScore

  const matches: OutboundSequence[] = []
  for (const seq of Object.values(OUTBOUND_SEQUENCES)) {
    const t = seq.trigger
    if (t.min_intent_score !== undefined && score < t.min_intent_score) continue
    if (t.signal_type && !types.has(t.signal_type)) continue
    matches.push(seq)
  }

  if (matches.length === 0) return null

  // Priorità: hot_lead > tender > hiring
  const order = ['hot_lead_play', 'tender_play', 'hiring_play']
  matches.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return matches[0]
}

export function getSequenceByKey(key: string): OutboundSequence | null {
  return OUTBOUND_SEQUENCES[key] ?? null
}

export function collectSignalTypesFromLead(lead: Record<string, unknown>): string[] {
  const types = new Set<string>()
  const worker = Array.isArray(lead.business_signals) ? lead.business_signals : []
  for (const s of worker) {
    if (s && typeof s === 'object') {
      const t = String((s as Record<string, unknown>).type || (s as Record<string, unknown>).signal_type || '')
      if (t) types.add(t)
    }
  }
  return [...types]
}
