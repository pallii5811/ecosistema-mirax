/**
 * Outreach Agent — guardrail anti-ban e validazione canale.
 */

import {
  CHANNEL_LABELS,
  DAILY_SOFT_LIMIT,
  OUTCOME_STATUSES,
  RECENT_CONTACT_DAYS,
  type OutreachStatusItem,
} from '../outreach.ts'

export type OutreachGuardrailInput = {
  channel: string
  status?: string
  dailySentCount?: number
  daysSinceLastContact?: number | null
  mode?: string
}

export type OutreachGuardrailResult = {
  allowed: boolean
  severity: 'ok' | 'warning' | 'block'
  reason?: string
  recommendedChannel?: string
}

const VALID_CHANNELS = new Set(Object.keys(CHANNEL_LABELS))

export function validateOutreachChannel(channel: string): boolean {
  return VALID_CHANNELS.has(channel.trim().toLowerCase())
}

export function validateOutreachStatus(status: string): boolean {
  return OUTCOME_STATUSES.has(status) || ['queued', 'sent', 'skipped', 'failed'].includes(status)
}

export function checkOutreachGuardrails(input: OutreachGuardrailInput): OutreachGuardrailResult {
  const channel = input.channel.trim().toLowerCase()
  if (!VALID_CHANNELS.has(channel)) {
    return { allowed: false, severity: 'block', reason: 'Canale outreach non valido' }
  }

  const daily = Number(input.dailySentCount) || 0
  if (daily >= DAILY_SOFT_LIMIT) {
    return {
      allowed: false,
      severity: 'block',
      reason: `Limite giornaliero soft (${DAILY_SOFT_LIMIT} contatti) raggiunto`,
    }
  }

  if (daily >= DAILY_SOFT_LIMIT - 10) {
    return {
      allowed: true,
      severity: 'warning',
      reason: `Vicino al limite giornaliero (${daily}/${DAILY_SOFT_LIMIT})`,
    }
  }

  const days = input.daysSinceLastContact
  if (days !== null && days !== undefined && days < RECENT_CONTACT_DAYS) {
    return {
      allowed: true,
      severity: 'warning',
      reason: `Lead contattato ${days} giorni fa — rischio duplicato`,
    }
  }

  return { allowed: true, severity: 'ok' }
}

export function summarizeOutreachHistory(items: OutreachStatusItem[]): {
  contacted: number
  interested: number
  responseRate: number
} {
  const sent = items.filter((i) => ['sent', 'replied', 'interested', 'not_interested', 'no_answer'].includes(i.status))
  const interested = items.filter((i) => i.status === 'interested' || i.status === 'replied').length
  const contacted = sent.length
  return {
    contacted,
    interested,
    responseRate: contacted > 0 ? Math.round((interested / contacted) * 100) : 0,
  }
}
