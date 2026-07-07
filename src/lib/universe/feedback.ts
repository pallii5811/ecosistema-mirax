/**
 * Feedback Loop — Fase 6 Knowledge Graph.
 *
 * Every user action on a lead (save, contact, export, thumb up/down, ignore,
 * closed-won/lost) becomes a training signal. The system learns:
 *   - which entities to boost/penalize for this user
 *   - which commercial signals correlate with success
 *   - which prompt examples to feed back to the intent parser
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommercialOpportunity } from './opportunity.ts'

export type FeedbackAction =
  | 'save'
  | 'contact'
  | 'export'
  | 'ignore'
  | 'dismiss'
  | 'thumb_up'
  | 'thumb_down'
  | 'closed_won'
  | 'closed_lost'

export type FeedbackRecord = {
  id: string
  user_id: string
  entity_id: string | null
  search_intent: Record<string, unknown>
  user_query: string | null
  action: FeedbackAction
  outcome: string | null
  feedback_value: number | null
  metadata: Record<string, unknown>
  created_at: string
}

export type FeedbackInput = {
  user_id: string
  entity_id?: string | null
  search_intent?: Record<string, unknown>
  user_query?: string | null
  action: FeedbackAction
  outcome?: string | null
  feedback_value?: number | null
  metadata?: Record<string, unknown>
}

export const FEEDBACK_ACTION_WEIGHTS: Record<FeedbackAction, number> = {
  thumb_up: 12,
  save: 8,
  contact: 10,
  export: 6,
  closed_won: 25,
  thumb_down: -15,
  ignore: -8,
  dismiss: -10,
  closed_lost: -12,
}

export function feedbackActionToValue(action: FeedbackAction): number {
  return FEEDBACK_ACTION_WEIGHTS[action] ?? 0
}

export async function recordFeedback(
  sb: SupabaseClient,
  input: FeedbackInput,
): Promise<FeedbackRecord> {
  const row = {
    user_id: input.user_id,
    entity_id: input.entity_id ?? null,
    search_intent: input.search_intent ?? {},
    user_query: input.user_query ?? null,
    action: input.action,
    outcome: input.outcome ?? null,
    feedback_value: input.feedback_value ?? feedbackActionToValue(input.action),
    metadata: input.metadata ?? {},
  }

  const { data, error } = await sb.from('universe_feedback').insert(row).select().single()
  if (error) {
    const err = new Error(`Feedback insert failed: ${error.message}`)
    err.cause = error
    throw err
  }
  return data as FeedbackRecord
}

export type FeedbackListOptions = {
  entityId?: string
  action?: FeedbackAction
  limit?: number
  since?: string
}

export async function listFeedback(
  sb: SupabaseClient,
  userId: string,
  opts: FeedbackListOptions = {},
): Promise<FeedbackRecord[]> {
  let q = sb.from('universe_feedback').select('*').eq('user_id', userId)

  if (opts.entityId) q = q.eq('entity_id', opts.entityId)
  if (opts.action) q = q.eq('action', opts.action)
  if (opts.since) q = q.gte('created_at', opts.since)
  q = q.order('created_at', { ascending: false })
  if (opts.limit) q = q.limit(opts.limit)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as FeedbackRecord[]
}

/**
 * Compute a per-entity feedback boost for a user.
 * Later feedback overrides earlier feedback for the same entity/action pair
 * (we keep the latest value per action).
 */
export async function getEntityFeedbackBoostMap(
  sb: SupabaseClient,
  userId: string,
  entityIds: string[],
): Promise<Map<string, number>> {
  if (!entityIds.length) return new Map()

  type FeedbackRow = { entity_id: string; action: FeedbackAction; created_at: string }

  const { data, error } = await sb
    .from('universe_feedback')
    .select('entity_id, action, created_at')
    .eq('user_id', userId)
    .in('entity_id', entityIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  const latestByEntityAction = new Map<string, FeedbackRow>()
  for (const row of (data ?? []) as unknown as FeedbackRow[]) {
    const key = `${row.entity_id}:${row.action}`
    if (!latestByEntityAction.has(key)) {
      latestByEntityAction.set(key, row)
    }
  }

  const boostByEntity = new Map<string, number>()
  for (const [, row] of latestByEntityAction) {
    const boost = feedbackActionToValue(row.action)
    const cur = boostByEntity.get(row.entity_id) ?? 0
    boostByEntity.set(row.entity_id, cur + boost)
  }

  return boostByEntity
}

export function applyFeedbackBoost(
  opportunities: CommercialOpportunity[],
  boostMap: Map<string, number>,
): CommercialOpportunity[] {
  return opportunities.map((opp) => {
    const boost = opp.entity.id ? (boostMap.get(opp.entity.id) ?? 0) : 0
    if (!boost) return opp
    return {
      ...opp,
      opportunity_score: Math.max(0, Math.min(100, opp.opportunity_score + boost)),
    }
  })
}

export type UserFeedbackProfile = {
  user_id: string
  positive_entity_ids: string[]
  negative_entity_ids: string[]
  top_actions: { action: FeedbackAction; count: number }[]
  recent_queries: string[]
}

export async function getUserFeedbackProfile(
  sb: SupabaseClient,
  userId: string,
): Promise<UserFeedbackProfile> {
  const { data, error } = await sb
    .from('universe_feedback')
    .select('entity_id, action, user_query')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw error

  const positive: Set<string> = new Set()
  const negative: Set<string> = new Set()
  const actionCounts = new Map<FeedbackAction, number>()
  const recentQueries: string[] = []

  for (const row of (data ?? []) as { entity_id: string | null; action: FeedbackAction; user_query: string | null }[]) {
    if (row.user_query && recentQueries.length < 20 && !recentQueries.includes(row.user_query)) {
      recentQueries.push(row.user_query)
    }
    actionCounts.set(row.action, (actionCounts.get(row.action) ?? 0) + 1)
    if (!row.entity_id) continue
    const v = feedbackActionToValue(row.action)
    if (v > 0) positive.add(row.entity_id)
    if (v < 0) negative.add(row.entity_id)
  }

  const topActions = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([action, count]) => ({ action, count }))

  return {
    user_id: userId,
    positive_entity_ids: Array.from(positive),
    negative_entity_ids: Array.from(negative),
    top_actions: topActions,
    recent_queries: recentQueries,
  }
}

export type FeedbackPromptExample = {
  query: string
  reasoning: string
  outcome: 'positive' | 'negative'
}

/**
 * Build few-shot examples from real user feedback to augment the intent parser.
 * Positive examples come from closed_won / thumb_up; negative from thumb_down / closed_lost.
 */
export async function buildFeedbackPromptExamples(
  sb: SupabaseClient,
  userId: string,
  limit = 6,
): Promise<FeedbackPromptExample[]> {
  const { data, error } = await sb
    .from('universe_feedback')
    .select('user_query, action, metadata')
    .eq('user_id', userId)
    .in('action', ['thumb_up', 'closed_won', 'thumb_down', 'closed_lost'])
    .not('user_query', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  const examples: FeedbackPromptExample[] = []
  for (const row of (data ?? []) as { user_query: string; action: FeedbackAction; metadata: Record<string, unknown> | null }[]) {
    const outcome = row.action === 'thumb_up' || row.action === 'closed_won' ? 'positive' : 'negative'
    examples.push({
      query: row.user_query,
      reasoning: (row.metadata?.reasoning as string) || (outcome === 'positive' ? 'Lead rilevante' : 'Lead non rilevante'),
      outcome,
    })
    if (examples.length >= limit) break
  }

  return examples
}
