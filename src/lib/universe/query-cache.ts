/**
 * Fase 9 — Cache read-only per query/analytics Universe (DB-backed, multi-instance).
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { wrapSupabaseError } from './errors.ts'

export type UniverseCacheKind = 'analytics' | 'agentic'

export function isUniverseCacheEnabled(): boolean {
  return process.env.UNIVERSE_CACHE_ENABLED === '1' || process.env.UNIVERSE_ENABLED === '1'
}

export function cacheTtlSeconds(kind: UniverseCacheKind): number {
  if (kind === 'analytics') {
    return Math.max(30, Number(process.env.UNIVERSE_CACHE_TTL_ANALYTICS) || 120)
  }
  return Math.max(60, Number(process.env.UNIVERSE_CACHE_TTL_AGENTIC) || 300)
}

export function buildUniverseCacheKey(kind: UniverseCacheKind, payload: unknown): string {
  const raw = JSON.stringify(payload)
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 32)
  return `${kind}:${hash}`
}

export async function getQueryCache<T>(
  sb: SupabaseClient,
  cacheKey: string,
): Promise<T | null> {
  const { data, error } = await sb
    .from('universe_query_cache')
    .select('payload, expires_at')
    .eq('cache_key', cacheKey)
    .maybeSingle()

  if (error) {
    if (/universe_query_cache|does not exist/i.test(error.message)) return null
    throw wrapSupabaseError(error)
  }
  if (!data?.payload) return null
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) return null
  return data.payload as T
}

export async function setQueryCache(
  sb: SupabaseClient,
  cacheKey: string,
  kind: UniverseCacheKind,
  payload: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const ttl = ttlSeconds ?? cacheTtlSeconds(kind)
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString()

  const { error } = await sb.from('universe_query_cache').upsert(
    {
      cache_key: cacheKey,
      cache_kind: kind,
      payload,
      expires_at,
    },
    { onConflict: 'cache_key' },
  )

  if (error) {
    if (/universe_query_cache|does not exist/i.test(error.message)) return
    throw wrapSupabaseError(error)
  }
}

export async function purgeExpiredQueryCache(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc('universe_purge_query_cache')
  if (!error && typeof data === 'number') return data

  const { error: delErr } = await sb
    .from('universe_query_cache')
    .delete()
    .lt('expires_at', new Date().toISOString())

  if (delErr && !/universe_query_cache|does not exist/i.test(delErr.message)) {
    throw wrapSupabaseError(delErr)
  }
  return 0
}
