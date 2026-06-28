/**
 * Blocco 9 — AI Act audit trail (explainability).
 * Aggrega rationale outreach, technical_report e motivazione score rule-based.
 */

import { analyzeLead } from '../utils/leadIntelligence.ts'

export type AiDecisionType = 'outreach' | 'score' | 'pitch' | 'insight'

export const AI_ACT_DISCLAIMER =
  'Decisioni MIRAX su score e outreach sono rule-based o assistite da AI con revisione umana. Nessuna decisione legale automatizzata.'

export type ScoreMotivation = {
  opportunity_score: number
  digital_maturity: number
  rule_based: true
  factors: Array<{ factor: string; points: number; active: boolean; explanation: string }>
  suggested_approach: string
  disclaimer: string
}

export type TechnicalReportSummary = {
  has_pixel: boolean | null
  has_gtm: boolean | null
  has_ssl: boolean | null
  seo_issues: boolean
  load_speed_s: number | null
  signals: string[]
}

export type LeadExplainabilityPackage = {
  entity_ref: string
  score_motivation: ScoreMotivation
  technical_report: TechnicalReportSummary
  ai_act: {
    transparency: true
    automated_legal_decision: false
    human_oversight: true
    disclaimer: string
  }
}

function summarizeTechnicalReport(tr: unknown): TechnicalReportSummary {
  const r = tr && typeof tr === 'object' ? (tr as Record<string, unknown>) : {}
  const signals: string[] = []

  const hasPixel = r.has_facebook_pixel === true || r.meta_pixel === true ? true : r.has_facebook_pixel === false ? false : null
  const hasGtm = r.has_gtm === true ? true : r.has_gtm === false ? false : null
  const hasSsl = r.has_ssl === true ? true : r.has_ssl === false ? false : null
  const seoIssues = r.seo_disaster === true || (Array.isArray(r.html_errors) && r.html_errors.length > 0)
  const loadSpeed = typeof r.load_speed_s === 'number' ? r.load_speed_s : typeof r.load_speed_seconds === 'number' ? r.load_speed_seconds : null

  if (hasPixel === false) signals.push('Senza Meta Pixel')
  if (hasGtm === false) signals.push('Senza GTM')
  if (hasSsl === false) signals.push('Senza SSL')
  if (seoIssues) signals.push('Problemi SEO')
  if (loadSpeed !== null && loadSpeed > 4) signals.push(`Sito lento (${loadSpeed}s)`)

  return {
    has_pixel: hasPixel,
    has_gtm: hasGtm,
    has_ssl: hasSsl,
    seo_issues: seoIssues,
    load_speed_s: loadSpeed,
    signals,
  }
}

export function buildScoreMotivation(lead: Record<string, unknown>): ScoreMotivation {
  const intel = analyzeLead(lead)
  const opportunity_score = Number(lead.opportunity_score ?? lead.score) || 0

  return {
    opportunity_score,
    digital_maturity: intel.digitalMaturity,
    rule_based: true,
    factors: intel.scoreBreakdown.map((f) => ({
      factor: f.factor,
      points: f.points,
      active: f.active,
      explanation: f.tip,
    })),
    suggested_approach: intel.suggestedApproach,
    disclaimer: AI_ACT_DISCLAIMER,
  }
}

export function buildLeadExplainabilityPackage(lead: Record<string, unknown>): LeadExplainabilityPackage {
  const nome = String(lead.nome ?? lead.azienda ?? lead.name ?? '').trim()
  const sito = String(lead.sito ?? lead.website ?? '').trim()
  const entity_ref = sito || nome || 'lead'

  return {
    entity_ref,
    score_motivation: buildScoreMotivation(lead),
    technical_report: summarizeTechnicalReport(lead.technical_report ?? lead.audit),
    ai_act: {
      transparency: true,
      automated_legal_decision: false,
      human_oversight: true,
      disclaimer: AI_ACT_DISCLAIMER,
    },
  }
}

export function buildOutreachAuditRecord(input: {
  channel: string
  status: string
  mode?: string
  message?: string | null
  rationale?: string | null
  lead_name?: string | null
  lead_website?: string | null
}): {
  decision_type: AiDecisionType
  entity_ref: string | null
  rationale: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  model: string | null
} {
  const entity_ref = input.lead_website || input.lead_name || null
  const rationale =
    (typeof input.rationale === 'string' && input.rationale.trim()) ||
    `Outreach ${input.channel} — stato ${input.status}`

  return {
    decision_type: 'outreach',
    entity_ref,
    rationale: rationale.slice(0, 600),
    inputs: {
      channel: input.channel,
      status: input.status,
      mode: input.mode ?? 'sell_service',
    },
    outputs: {
      message_preview:
        typeof input.message === 'string' ? input.message.trim().slice(0, 200) : null,
    },
    model: input.rationale ? 'gpt-4o-mini' : null,
  }
}

export function buildPitchAuditRecord(input: {
  lead_name?: string
  rationale?: string
  subject?: string
}): {
  decision_type: AiDecisionType
  entity_ref: string | null
  rationale: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  model: string
} {
  return {
    decision_type: 'pitch',
    entity_ref: input.lead_name ?? null,
    rationale: (input.rationale || 'Pitch generato da segnali tecnici del lead').slice(0, 600),
    inputs: { lead_name: input.lead_name ?? null },
    outputs: { subject_preview: input.subject?.slice(0, 120) ?? null },
    model: 'gpt-4o-mini',
  }
}

export function buildComplianceAuditRecord(input: {
  userId: string
  channel: string
  target: string
  status: string
}): {
  user_id: string
  decision_type: 'outreach'
  entity_ref: string
  rationale: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  model: null
} {
  return {
    user_id: input.userId,
    decision_type: 'outreach',
    entity_ref: input.target,
    rationale: `Conferma outreach ${input.channel} — esito compliance: ${input.status}. Base giuridica: legittimo interesse B2B, fonte pubblica, revisione umana.`,
    inputs: {
      channel: input.channel,
      target: input.target.slice(0, 120),
      compliance_status: input.status,
      gdpr_basis: 'legittimo_interesse_art6_1_f',
    },
    outputs: {
      human_oversight: true,
      automated_legal_decision: false,
    },
    model: null,
  }
}

export function buildReplyClassificationAuditRecord(input: {
  userId: string
  intent: string
  replySnippet: string
  suggestedAction: string
  model: string
  leadName?: string
}): {
  user_id: string
  decision_type: 'outreach'
  entity_ref: string | null
  rationale: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  model: string
} {
  return {
    user_id: input.userId,
    decision_type: 'outreach',
    entity_ref: input.leadName ?? null,
    rationale: `Classificazione risposta inbound: ${input.intent}. Suggerimento: ${input.suggestedAction.slice(0, 200)}`,
    inputs: {
      reply_preview: input.replySnippet.slice(0, 200),
      intent: input.intent,
    },
    outputs: {
      suggested_action: input.suggestedAction.slice(0, 300),
      human_oversight: true,
      automated_send: false,
    },
    model: input.model,
  }
}
