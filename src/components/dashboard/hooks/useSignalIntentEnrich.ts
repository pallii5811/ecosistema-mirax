'use client'

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { leadRowKey } from '@/components/dashboard/lead-utils'
import { isAuditPendingLead } from '@/lib/lead-audit-status'
import {
  hasVerifiedMarketingAdSpend,
  isMarketingAdLookupDone,
} from '@/lib/signal-intent/marketing-investment'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

type AdsPresence = {
  facebookAds?: {
    apiVerified?: boolean
    activeAdsFound?: number | null
    libraryUrl?: string
  }
}

function readString(lead: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function patchLeadFromAds(lead: Record<string, unknown>, analysis: AdsPresence): Record<string, unknown> {
  const verified = analysis.facebookAds?.apiVerified === true
  const count = analysis.facebookAds?.activeAdsFound ?? null
  const libraryUrl = analysis.facebookAds?.libraryUrl
  const tr = {
    ...((lead.technical_report && typeof lead.technical_report === 'object'
      ? lead.technical_report
      : {}) as Record<string, unknown>),
    meta_ads_verified: verified,
    active_meta_ads: count,
  }

  const existing = Array.isArray(lead.business_signals) ? [...lead.business_signals] : []
  if (verified && count !== null && count > 0) {
    const dup = existing.some(
      (s) =>
        s &&
        typeof s === 'object' &&
        String((s as Record<string, unknown>).type || '') === 'investing_marketing',
    )
    if (!dup) {
      existing.push({
        type: 'investing_marketing',
        title: `${count} inserzioni Meta attive`,
        severity: 'high',
        confidence: 94,
        status: 'confirmed',
        evidence: [
          {
            label: 'Meta Ad Library',
            value: `${count} inserzioni attive`,
            source: 'meta_ad_library',
            url: libraryUrl,
          },
        ],
      })
    }
  }

  return {
    ...lead,
    meta_ads_verified: verified,
    active_meta_ads: count,
    meta_ad_library_url: libraryUrl,
    meta_ads_lookup_at: new Date().toISOString(),
    technical_report: tr,
    business_signals: existing,
  }
}

/**
 * Arricchimento segnali d'acquisto post-discovery:
 * - Claude batch (ricerca web + evidenze per la query)
 * - Meta Ad Library quando la query chiede investimento marketing
 */
export function useSignalIntentEnrich(
  results: unknown[],
  query: string,
  signalIntent: SignalIntentSpec | null | undefined,
  setResults: Dispatch<SetStateAction<unknown[]>>,
) {
  const claudeBusyRef = useRef(false)
  const adsBusyRef = useRef(false)

  const mergeEnrichedLeads = useCallback(
    (patch: unknown[]) => {
      if (!Array.isArray(patch) || patch.length === 0) return
      const byKey = new Map<string, Record<string, unknown>>()
      for (const item of patch) {
        if (!item || typeof item !== 'object') continue
        const row = item as Record<string, unknown>
        byKey.set(leadRowKey(row), row)
      }
      if (byKey.size === 0) return
      setResults((prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((item) => {
          if (!item || typeof item !== 'object') return item
          const row = item as Record<string, unknown>
          const enriched = byKey.get(leadRowKey(row))
          return enriched ? { ...row, ...enriched } : item
        })
      })
    },
    [setResults],
  )

  const wantsMarketingSpend = Boolean(signalIntent?.required_signals?.includes('investing_marketing'))
  const wantsSignalEnrich = Boolean(signalIntent?.required_signals?.length || signalIntent?.reasoning)

  // Claude — evidenze verificabili per la richiesta utente
  useEffect(() => {
    if (!wantsSignalEnrich || !query.trim()) return
    if (!Array.isArray(results) || results.length === 0) return
    if (claudeBusyRef.current) return

    const pending = results
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>)
      .filter((row) => !row.claude_enrichment && !isAuditPendingLead(row))
      .slice(0, 15)

    if (pending.length === 0) return

    claudeBusyRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch('/api/claude-enrich-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_query: query.trim(),
            signal_intent: signalIntent,
            leads: pending,
            max_leads: 15,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!cancelled && res.ok && Array.isArray(data?.leads)) {
          mergeEnrichedLeads(data.leads)
        }
      } catch {
        /* retry on next results tick */
      } finally {
        if (!cancelled) claudeBusyRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [wantsSignalEnrich, query, signalIntent, results, mergeEnrichedLeads])

  // Meta Ad Library — prova ufficiale di budget ads attivo
  useEffect(() => {
    if (!wantsMarketingSpend) return
    if (!Array.isArray(results) || results.length === 0) return
    if (adsBusyRef.current) return

    const pending = results
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>)
      .filter(
        (row) =>
          !isAuditPendingLead(row) &&
          !isMarketingAdLookupDone(row) &&
          !hasVerifiedMarketingAdSpend(row),
      )
      .slice(0, 8)

    if (pending.length === 0) return

    adsBusyRef.current = true
    let cancelled = false

    ;(async () => {
      const patches: Record<string, unknown>[] = []
      for (const lead of pending) {
        if (cancelled) break
        const name = readString(lead, ['azienda', 'nome', 'name', 'company'])
        const website = readString(lead, ['sito', 'website', 'url'])
        if (!name && !website) {
          patches.push({ ...lead, meta_ads_lookup_at: new Date().toISOString() })
          continue
        }
        const city = readString(lead, ['citta', 'city', 'localita'])
        const category = readString(lead, ['categoria', 'category'])
        const metaPixel = lead.meta_pixel === true ? '1' : '0'
        const googleAdsTag = lead.google_ads === true ? '1' : '0'
        const qs = new URLSearchParams({
          name,
          website,
          city,
          category,
          metaPixel,
          googleAdsTag,
        })
        try {
          const res = await fetch(`/api/lead-ads?${qs.toString()}`)
          const data = (await res.json().catch(() => null)) as AdsPresence | null
          if (res.ok && data) {
            patches.push(patchLeadFromAds(lead, data))
          } else {
            patches.push({ ...lead, meta_ads_lookup_at: new Date().toISOString() })
          }
        } catch {
          patches.push({ ...lead, meta_ads_lookup_at: new Date().toISOString() })
        }
      }
      if (!cancelled && patches.length) mergeEnrichedLeads(patches)
      if (!cancelled) adsBusyRef.current = false
    })()

    return () => {
      cancelled = true
    }
  }, [wantsMarketingSpend, results, mergeEnrichedLeads])
}
