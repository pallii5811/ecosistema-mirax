/**
 * Fase 8.1 — Supabase Realtime su lead_business_signals.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWebsiteUrl } from '@/lib/website-diff/detect'

export type RealtimeBusinessSignal = {
  id: string
  user_id: string
  lead_website: string
  lead_name: string | null
  signal_type: string
  title: string
  severity: string
  confidence: number
  evidence: unknown
  source: string
  detected_at: string
}

export function realtimeSignalToLeadPatch(signal: RealtimeBusinessSignal) {
  return {
    type: signal.signal_type,
    title: signal.title,
    confidence: signal.confidence,
    evidence: signal.evidence,
    source: signal.source,
    detected_at: signal.detected_at,
  }
}

export function applyRealtimeSignalToResults(
  results: unknown[],
  signal: RealtimeBusinessSignal,
): unknown[] {
  const target = normalizeWebsiteUrl(signal.lead_website)
  if (!target) return results

  let changed = false
  const next = results.map((item) => {
    if (!item || typeof item !== 'object') return item
    const lead = item as Record<string, unknown>
    const raw = String(lead.sito || lead.website || lead.url || '').trim()
    const w = normalizeWebsiteUrl(raw)
    if (!w || (w !== target && !w.endsWith(target) && !target.endsWith(w))) return item

    const existing = Array.isArray(lead.business_signals)
      ? (lead.business_signals as Record<string, unknown>[])
      : []
    const patch = realtimeSignalToLeadPatch(signal)
    const dup = existing.some(
      (s) =>
        String(s.type || s.signal_type) === patch.type &&
        String(s.title) === patch.title,
    )
    if (dup) return item

    changed = true
    return {
      ...lead,
      business_signals: [...existing, patch],
      business_enriched_at: new Date().toISOString(),
    }
  })

  return changed ? next : results
}

export function subscribeToSignals(
  supabase: SupabaseClient,
  userId: string,
  callback: (signal: RealtimeBusinessSignal) => void,
): () => void {
  const channel = supabase
    .channel(`mirax_business_signals_${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'lead_business_signals',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as RealtimeBusinessSignal
        if (row?.id) callback(row)
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
