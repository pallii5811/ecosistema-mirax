import { createHash } from 'node:crypto'

import { createClient as createJsClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CommercialSearchPlan } from '@/lib/contracts/commercial-search-plan'

const TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Capture fetch at module load so unit tests can mock globalThis.fetch for the
 * Anthropic compiler without turning research_cache I/O into fake "model calls".
 */
const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis)

function cacheClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return null
  return createJsClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: nativeFetch },
  })
}

export function semanticQueryCacheKey(input: {
  query: string
  requestedCount: number
  language: string
  modelVersion: string
  interpreterSchemaVersion: string
}): string {
  const normalized = JSON.stringify({
    query: input.query.trim().toLocaleLowerCase('it'),
    requested_count: Math.max(1, Math.trunc(input.requestedCount)),
    language: input.language,
    model_version: input.modelVersion,
    interpreter_schema_version: input.interpreterSchemaVersion,
  })
  return `semantic-query:${createHash('sha256').update(normalized).digest('hex')}`
}

export async function getSemanticQueryCache(cacheKey: string): Promise<CommercialSearchPlan | null> {
  try {
    const supabase = cacheClient()
    if (!supabase) return null
    const { data, error } = await supabase
      .from('research_cache')
      .select('payload, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    if (error || !data || new Date(String(data.expires_at)).getTime() <= Date.now()) return null
    return data.payload as CommercialSearchPlan
  } catch {
    return null
  }
}

export async function setSemanticQueryCache(cacheKey: string, plan: CommercialSearchPlan): Promise<void> {
  try {
    const supabase = cacheClient()
    if (!supabase) return
    await supabase.from('research_cache').upsert({
      cache_key: cacheKey,
      lead_website: 'semantic-query-contract',
      payload: plan,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    }, { onConflict: 'cache_key' })
  } catch {
    // Cache failure must never weaken validation or trigger an extra repair call.
  }
}
