/**
 * Opportunity Graph — the real object of MIRAX Commercial Intelligence.
 *
 * Company + signals + evidence + reasoning + commercial score = Opportunity.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import type { UniverseEntity } from './types.ts'
import type { HopEvidence } from './graph-reasoning.ts'
import {
  detectCommercialSignals,
  detectCommercialSignalsForEntity,
  loadEntityFacts,
  type CommercialSignal,
  type CommercialSignalEvidence,
  type EntityFacts,
  type EntitySignalBundle,
} from './commercial-signals.ts'

export type CommercialOpportunity = {
  entity: UniverseEntity
  /** Overall commercial opportunity score (0-100) */
  opportunity_score: number
  /** Graph rank sub-score (0-100) */
  graph_score: number
  /** Commercial signals detected for this entity */
  signals: CommercialSignal[]
  /** Flattened evidence from all signals */
  evidence: CommercialSignalEvidence[]
  /** Human-readable why this lead matches */
  reasoning: string
  /** Fit score vs the expressed intent */
  intent_fit_score: number
  /** Multi-hop graph path that explains why this lead was reached */
  path_evidence: HopEvidence[]
}

function formatEuro(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k€`
  return `${n}€`
}

function signalLabel(type: CommercialSignal['type']): string {
  const map: Record<CommercialSignal['type'], string> = {
    growth: 'Crescita',
    buying: 'Intenzione d\'acquisto',
    digital_transformation: 'Trasformazione digitale',
    budget: 'Budget disponibile',
    urgency: 'Urgenza',
    pain: 'Dolore / gap',
    intent_fit: 'Match con intent',
  }
  return map[type]
}

function formatPathEvidence(path: HopEvidence[]): string {
  if (path.length === 0) return ''
  return path
    .map((hop) => `${hop.from_entity_name} · ${hop.relationship_type} · ${hop.to_entity_name}`)
    .join(' → ')
}

function buildReasoning(opportunity: CommercialOpportunity, intent?: CommercialIntent): string {
  const parts: string[] = []
  const { entity, signals, evidence, path_evidence } = opportunity

  if (path_evidence.length) {
    parts.push(`Percorso grafo: ${formatPathEvidence(path_evidence)}`)
  }

  if (signals.length === 0) {
    if (parts.length) return parts.join(' · ')
    return `${entity.name} corrisponde ai filtri base, ma non abbiamo ancora evidenze commerciali forti nel grafo.`
  }

  // Top 2 signals by score
  const top = [...signals].sort((a, b) => b.score - a.score).slice(0, 2)
  for (const s of top) {
    const strongest = s.evidence[0]?.claim
    if (strongest) {
      parts.push(`${signalLabel(s.type)}: ${strongest}`)
    }
  }

  // Intent-specific bridge
  if (intent?.user_service_description) {
    parts.push(`Il profilo combina con "${intent.user_service_description}".`)
  }

  if (evidence.length > 2) {
    parts.push(`Evidenze totali: ${evidence.length}.`)
  }

  return parts.join(' · ')
}

function buildOpportunityFromSignals(
  entity: UniverseEntity,
  bundle: EntitySignalBundle,
  graphScore: number,
  intent?: CommercialIntent,
  pathEvidence?: HopEvidence[],
): CommercialOpportunity {
  const signals = bundle.signals
  const evidence = signals.flatMap((s) => s.evidence)

  // Opportunity score: weighted blend of commercial signals and graph rank
  let commercialScore = 0
  let weightSum = 0
  for (const s of signals) {
    const w = s.confidence
    commercialScore += s.score * w
    weightSum += w
  }
  const avgCommercial = weightSum > 0 ? commercialScore / weightSum : 0

  // Graph rank contributes 25% when signals exist, 60% when no signals
  const graphWeight = signals.length ? 0.25 : 0.6
  const opportunityScore = Math.round(avgCommercial * (1 - graphWeight) + graphScore * graphWeight)

  const intentFitSignal = signals.find((s) => s.type === 'intent_fit')
  const intentFitScore = intentFitSignal?.score ?? 0

  const opp: CommercialOpportunity = {
    entity,
    opportunity_score: Math.min(100, opportunityScore),
    graph_score: graphScore,
    signals,
    evidence,
    reasoning: '',
    intent_fit_score: intentFitScore,
    path_evidence: pathEvidence ?? [],
  }

  opp.reasoning = buildReasoning(opp, intent)
  return opp
}

export async function buildCommercialOpportunities(
  sb: SupabaseClient,
  entities: UniverseEntity[],
  graphScores: Map<string, number>,
  intent?: CommercialIntent,
  pathEvidenceMap?: Map<string, HopEvidence[]>,
): Promise<CommercialOpportunity[]> {
  if (entities.length === 0) return []

  const bundles = await detectCommercialSignals(sb, entities, intent)

  return entities.map((entity) => {
    const bundle = bundles.get(entity.id) ?? { entity_id: entity.id, signals: [], summary: '' }
    const graphScore = graphScores.get(entity.id) ?? 50
    const pathEvidence = pathEvidenceMap?.get(entity.id)
    return buildOpportunityFromSignals(entity, bundle, graphScore, intent, pathEvidence)
  })
}

export function buildOpportunityForEntity(
  facts: EntityFacts,
  graphScore: number,
  intent?: CommercialIntent,
  pathEvidence?: HopEvidence[],
): CommercialOpportunity {
  const bundle = detectCommercialSignalsForEntity(facts, intent)
  return buildOpportunityFromSignals(facts.entity, bundle, graphScore, intent, pathEvidence)
}

export function rankOpportunities(opportunities: CommercialOpportunity[]): CommercialOpportunity[] {
  return [...opportunities].sort((a, b) => b.opportunity_score - a.opportunity_score)
}

export function topEvidence(
  opportunity: CommercialOpportunity,
  limit = 5,
): CommercialSignalEvidence[] {
  return opportunity.evidence.slice(0, limit)
}

export function formatOpportunityScore(score: number): string {
  return `${score}/100`
}
