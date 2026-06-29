/**
 * Universe sidecar — gated ingest from legacy MIRAX flows (default OFF).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestMiraxLead, type MiraxLeadInput } from './ingest-lead.ts'
import type { IngestResult } from './types.ts'

export function isUniverseEnabled(): boolean {
  return process.env.UNIVERSE_ENABLED === '1'
}

/** Fire-and-forget safe ingest; never throws to caller. */
export async function ingestMiraxLeadSidecar(
  sb: SupabaseClient,
  lead: MiraxLeadInput,
  source: string,
  userId?: string | null,
): Promise<IngestResult | null> {
  if (!isUniverseEnabled()) return null
  try {
    return await ingestMiraxLead(sb, lead, source, userId)
  } catch (e) {
    console.warn(`[universe sidecar] ingest failed (${source}):`, e)
    return null
  }
}

/** Non-blocking wrapper for API routes. */
export function ingestMiraxLeadSidecarAsync(
  sb: SupabaseClient,
  lead: MiraxLeadInput,
  source: string,
  userId?: string | null,
): void {
  if (!isUniverseEnabled()) return
  void ingestMiraxLeadSidecar(sb, lead, source, userId).catch(() => {})
}
