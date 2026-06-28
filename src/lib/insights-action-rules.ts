/**
 * Regole pure per "Cosa fare ora" — testabili senza Supabase.
 */

export type InsightAction = {
  type: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  body: string
  cta: { label: string; href: string }
  count: number
  examples: string[]
}

const DAY_MS = 86_400_000

export function buildPipelineActions(
  pipeline: Array<{
    lead_name?: string
    stage?: string
    deal_value?: number
    lead_score?: number
    updated_at?: string
  }>,
  now = Date.now(),
): InsightAction[] {
  const actions: InsightAction[] = []
  const active = pipeline.filter((p) => !['vinto', 'perso'].includes(String(p.stage ?? '')))

  const stagnant = active.filter((p) => {
    const t = p.updated_at ? Date.parse(p.updated_at) : NaN
    return Number.isFinite(t) && (now - t) / DAY_MS > 7
  })
  if (stagnant.length > 0) {
    actions.push({
      type: 'stagnant',
      severity: stagnant.length >= 3 ? 'critical' : 'warning',
      title: `${stagnant.length} deal fermi da oltre 7 giorni`,
      body: 'Riattiva questi deal con una sequenza o una chiamata oggi.',
      cta: { label: 'Vai alla Pipeline', href: '/dashboard/pipeline' },
      count: stagnant.length,
      examples: stagnant.slice(0, 3).map((p) => String(p.lead_name ?? '')),
    })
  }

  const urgentProposals = active.filter((p) => {
    if (p.stage !== 'proposta') return false
    const t = p.updated_at ? Date.parse(p.updated_at) : NaN
    return Number.isFinite(t) && (now - t) / DAY_MS > 3
  })
  if (urgentProposals.length > 0) {
    actions.push({
      type: 'urgent_proposal',
      severity: 'critical',
      title: `${urgentProposals.length} proposta${urgentProposals.length > 1 ? 'e' : ''} in attesa`,
      body: 'Follow-up entro 3 giorni dalla proposta per non perdere calore.',
      cta: { label: 'Pipeline → Proposta', href: '/dashboard/pipeline' },
      count: urgentProposals.length,
      examples: urgentProposals.slice(0, 3).map((p) => String(p.lead_name ?? '')),
    })
  }

  const hotUncontacted = active.filter((p) => p.stage === 'nuovo' && Number(p.lead_score) >= 70)
  if (hotUncontacted.length > 0) {
    actions.push({
      type: 'hot_uncontacted',
      severity: 'warning',
      title: `${hotUncontacted.length} lead HOT mai contattati`,
      body: 'Score 70+ in stage Nuovo: priorità outreach oggi.',
      cta: { label: 'Lead salvati', href: '/dashboard/leads' },
      count: hotUncontacted.length,
      examples: hotUncontacted.slice(0, 3).map((p) => String(p.lead_name ?? '')),
    })
  }

  return actions
}

export function buildEdatActions(input: {
  staleLeadCount: number
  staleExamples?: string[]
  unreadAlerts: number
  monitoredCount: number
  outreachFollowUpCount: number
  outreachExamples?: string[]
  pendingSequenceEmails: number
}): InsightAction[] {
  const actions: InsightAction[] = []

  if (input.staleLeadCount > 0) {
    actions.push({
      type: 'stale_leads',
      severity: input.staleLeadCount >= 10 ? 'warning' : 'info',
      title: `${input.staleLeadCount} lead con dati da rivalutare`,
      body: 'Freshness sotto 50/100: sito, pixel o contatti potrebbero essere obsoleti. Il cron re-audit li aggiorna automaticamente.',
      cta: { label: 'Vedi risultati ricerca', href: '/dashboard' },
      count: input.staleLeadCount,
      examples: (input.staleExamples ?? []).slice(0, 3),
    })
  }

  if (input.unreadAlerts > 0) {
    actions.push({
      type: 'unread_alerts',
      severity: 'warning',
      title: `${input.unreadAlerts} alert da leggere`,
      body: 'Cambiamenti tecnici o eventi outreach richiedono attenzione.',
      cta: { label: 'Apri Insights', href: '/dashboard/insights' },
      count: input.unreadAlerts,
      examples: [],
    })
  }

  if (input.monitoredCount > 0) {
    actions.push({
      type: 'monitored_leads',
      severity: 'info',
      title: `${input.monitoredCount} lead in monitoraggio attivo`,
      body: 'Riceverai alert quando pixel, social o rating cambiano.',
      cta: { label: 'Lead monitorati', href: '/dashboard/leads' },
      count: input.monitoredCount,
      examples: [],
    })
  }

  if (input.outreachFollowUpCount > 0) {
    actions.push({
      type: 'outreach_followup',
      severity: 'critical',
      title: `${input.outreachFollowUpCount} outreach senza esito da 3+ giorni`,
      body: 'Registra esito (interessato / no risposta) o invia follow-up.',
      cta: { label: 'Outreach', href: '/dashboard/outreach' },
      count: input.outreachFollowUpCount,
      examples: (input.outreachExamples ?? []).slice(0, 3),
    })
  }

  if (input.pendingSequenceEmails > 0) {
    actions.push({
      type: 'sequence_pending',
      severity: 'info',
      title: `${input.pendingSequenceEmails} email sequenza in coda`,
      body: 'Il dispatcher le invierà automaticamente; verifica mittente e copy.',
      cta: { label: 'Campagne', href: '/dashboard/outreach' },
      count: input.pendingSequenceEmails,
      examples: [],
    })
  }

  return actions
}

export function sortInsightActions(actions: InsightAction[]): InsightAction[] {
  const order = { critical: 0, warning: 1, info: 2 }
  return [...actions].sort((a, b) => order[a.severity] - order[b.severity])
}
