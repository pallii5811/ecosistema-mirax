/**
 * Fase 10 — Webhook outbound per eventi Universe (Zapier/Make/user_integrations).
 */

import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEntity, UniverseEvent } from './types.ts'
import { labelEvent } from './labels.ts'
import { wrapSupabaseError } from './errors.ts'

const TIMEOUT_MS = 12_000

export function isUniverseWebhooksEnabled(): boolean {
  return process.env.UNIVERSE_WEBHOOKS_ENABLED === '1' || process.env.UNIVERSE_ENABLED === '1'
}

type WebhookTarget = { user_id: string; url: string; secret?: string }

async function findWebhookTargets(sb: SupabaseClient, userIds: string[]): Promise<WebhookTarget[]> {
  const targets: WebhookTarget[] = []
  const seen = new Set<string>()

  for (const userId of userIds) {
    const { data: integ } = await sb
      .from('user_integrations')
      .select('webhook_url')
      .eq('user_id', userId)
      .maybeSingle()

    const url = typeof integ?.webhook_url === 'string' ? integ.webhook_url.trim() : ''
    if (url && /^https?:\/\//i.test(url)) {
      const key = `${userId}:${url}`
      if (!seen.has(key)) {
        seen.add(key)
        targets.push({ user_id: userId, url })
      }
    }

    const { data: crmRows } = await sb
      .from('crm_integrations')
      .select('config')
      .eq('user_id', userId)
      .eq('type', 'webhook')
      .eq('is_active', true)

    for (const row of crmRows ?? []) {
      const cfg = row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
      const crmUrl = typeof cfg.url === 'string' ? cfg.url.trim() : ''
      const secret = typeof cfg.secret === 'string' ? cfg.secret : undefined
      if (crmUrl && /^https?:\/\//i.test(crmUrl)) {
        const key = `${userId}:${crmUrl}`
        if (!seen.has(key)) {
          seen.add(key)
          targets.push({ user_id: userId, url: crmUrl, secret })
        }
      }
    }
  }

  return targets
}

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

async function postWebhook(
  url: string,
  body: Record<string, unknown>,
  secret?: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = JSON.stringify(body)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MIRAX-Universe/1.0',
  }
  if (secret) headers['X-MiraX-Signature'] = signPayload(secret, payload)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Webhook error' }
  }
}

async function logDelivery(
  sb: SupabaseClient,
  row: {
    user_id: string
    event_id?: string
    entity_id?: string
    webhook_url: string
    status: 'success' | 'error'
    response_code?: number
    error_message?: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await sb.from('universe_webhook_deliveries').insert(row)
  if (error && !/universe_webhook_deliveries|does not exist/i.test(error.message)) {
    console.warn('[universe/webhooks] log failed:', error.message)
  }
}

export async function dispatchUniverseEventWebhooks(
  sb: SupabaseClient,
  event: UniverseEvent,
  entity: UniverseEntity,
  userIds: string[],
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!isUniverseWebhooksEnabled()) return { sent: 0, failed: 0, skipped: true }
  if (!userIds.length) return { sent: 0, failed: 0, skipped: false }

  const targets = await findWebhookTargets(sb, userIds)
  if (!targets.length) return { sent: 0, failed: 0, skipped: false }

  const envelope = {
    type: 'universe.graph.event',
    version: 1,
    event_type: event.event_type,
    event_label: labelEvent(event.event_type),
    entity_id: entity.id,
    entity_name: entity.name,
    canonical_id: entity.canonical_id,
    city: entity.city,
    occurred_at: event.occurred_at,
    source: event.source,
    payload: event.payload,
  }

  let sent = 0
  let failed = 0

  for (const t of targets) {
    const result = await postWebhook(t.url, envelope, t.secret)
    await logDelivery(sb, {
      user_id: t.user_id,
      event_id: event.id,
      entity_id: entity.id,
      webhook_url: t.url,
      status: result.ok ? 'success' : 'error',
      response_code: result.status,
      error_message: result.error,
      payload: envelope,
    })
    if (result.ok) sent++
    else failed++
  }

  return { sent, failed, skipped: false }
}

export async function listWebhookDeliveries(
  sb: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<unknown[]> {
  const { data, error } = await sb
    .from('universe_webhook_deliveries')
    .select('id, event_id, entity_id, status, response_code, error_message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    if (/universe_webhook_deliveries|does not exist/i.test(error.message)) return []
    throw wrapSupabaseError(error)
  }
  return data ?? []
}
