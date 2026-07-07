/**
 * PII Exposure — controlled, audited, rate-limited.
 *
 * Phone, email, PEC and mobile contacts are valuable but sensitive.
 * We expose them only through explicit access points that write an audit log.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEntity } from './types.ts'
import { getLatestObservation } from './observation-repository.ts'
import { entityToMiraxLeadRow } from './agentic-search.ts'

export type PiiAccessType = 'phone' | 'email' | 'pec_email' | 'mobile_phone' | 'all'

export type EntityPii = {
  entity_id: string
  phone: string | null
  email: string | null
  pec_email: string | null
  mobile_phone: string | null
}

export type PiiAccessLog = {
  id: string
  user_id: string
  entity_id: string
  access_type: PiiAccessType
  reason: string | null
  source: string
  created_at: string
}

const PII_ATTRIBUTES = ['phone', 'email', 'pec_email', 'mobile_phone'] as const

export async function getEntityPii(sb: SupabaseClient, entityId: string): Promise<EntityPii> {
  const out: EntityPii = {
    entity_id: entityId,
    phone: null,
    email: null,
    pec_email: null,
    mobile_phone: null,
  }
  for (const attr of PII_ATTRIBUTES) {
    const obs = await getLatestObservation(sb, entityId, attr)
    if (obs?.value != null) {
      out[attr] = String(obs.value)
    }
  }
  return out
}

export async function logPiiAccess(
  sb: SupabaseClient,
  input: {
    user_id: string
    entity_id: string
    access_type: PiiAccessType
    reason?: string | null
    source?: string
  },
): Promise<PiiAccessLog> {
  const row = {
    user_id: input.user_id,
    entity_id: input.entity_id,
    access_type: input.access_type,
    reason: input.reason ?? null,
    source: input.source ?? 'dashboard',
  }
  const { data, error } = await sb.from('universe_pii_access_log').insert(row).select().single()
  if (error) {
    const err = new Error(`PII access log failed: ${error.message}`)
    err.cause = error
    throw err
  }
  return data as PiiAccessLog
}

export async function getUserPiiAccessCount(
  sb: SupabaseClient,
  userId: string,
  windowHours = 24,
): Promise<number> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
  const { count, error } = await sb
    .from('universe_pii_access_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}

export type PiiAccessPolicy = {
  max_daily_accesses: number
  require_reason: boolean
}

export const DEFAULT_PII_POLICY: PiiAccessPolicy = {
  max_daily_accesses: 200,
  require_reason: false,
}

export async function checkPiiAccessAllowed(
  sb: SupabaseClient,
  userId: string,
  policy: PiiAccessPolicy = DEFAULT_PII_POLICY,
): Promise<{ allowed: boolean; remaining: number; count: number }> {
  const count = await getUserPiiAccessCount(sb, userId, 24)
  const remaining = Math.max(0, policy.max_daily_accesses - count)
  return { allowed: count < policy.max_daily_accesses, remaining, count }
}

/**
 * Returns a lead row with PII fields populated from observations.
 * Use only in contexts where the user is authenticated and access is audited.
 */
export async function entityToMiraxLeadRowWithPii(
  sb: SupabaseClient,
  entity: UniverseEntity,
): Promise<Record<string, unknown>> {
  const row = await entityToMiraxLeadRow(sb, entity)
  const pii = await getEntityPii(sb, entity.id)
  row.telefono = pii.phone
  row.email = pii.email
  row.pec_email = pii.pec_email
  row.mobile_phone = pii.mobile_phone
  return row
}
