import { createServiceRoleClient } from '@/utils/supabase/server'
import type { ResearchAgentOutput } from './types.ts'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function researchCacheKey(leadWebsite: string, query?: string): string {
  const base = (leadWebsite || 'unknown').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const q = (query || '').toLowerCase().trim().slice(0, 80)
  return q ? `${base}::${q}` : base
}

export async function getResearchCache(
  cacheKey: string,
): Promise<ResearchAgentOutput | null> {
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('research_cache')
      .select('payload, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle()

    if (error || !data) return null
    const expires = new Date(String(data.expires_at)).getTime()
    if (Number.isFinite(expires) && expires < Date.now()) return null
    return data.payload as ResearchAgentOutput
  } catch {
    return null
  }
}

export async function setResearchCache(
  cacheKey: string,
  leadWebsite: string,
  payload: ResearchAgentOutput,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    const expires_at = new Date(Date.now() + CACHE_TTL_MS).toISOString()
    await supabase.from('research_cache').upsert(
      {
        cache_key: cacheKey,
        lead_website: leadWebsite,
        payload,
        expires_at,
      },
      { onConflict: 'cache_key' },
    )
  } catch {
    /* cache best-effort */
  }
}
