'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deriveOutreach,
  leadMatchKeys,
  type OutreachStatusItem,
} from '@/lib/outreach'

// Loads the user's outreach log once and exposes per-lead lookups so the
// anti-duplicate guardrail and "already contacted" badges work on every screen.
export function useOutreachStatus() {
  const [items, setItems] = useState<OutreachStatusItem[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/status', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!data) return
      setEnabled(data.enabled !== false)
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      /* best-effort */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const derived = useMemo(() => deriveOutreach(items), [items])

  const getLastContact = useCallback(
    (website: string | null | undefined, name: string | null | undefined): string | null => {
      for (const k of leadMatchKeys(website, name)) {
        const v = derived.lastSend.get(k)
        if (v) return v
      }
      return null
    },
    [derived]
  )

  const getOutcome = useCallback(
    (website: string | null | undefined, name: string | null | undefined): string | null => {
      for (const k of leadMatchKeys(website, name)) {
        const v = derived.latestOutcome.get(k)
        if (v) return v
      }
      return null
    },
    [derived]
  )

  const isContacted = useCallback(
    (website: string | null | undefined, name: string | null | undefined): boolean =>
      leadMatchKeys(website, name).some((k) => derived.sentKeys.has(k)),
    [derived]
  )

  return { enabled, loaded, items, reload, getLastContact, getOutcome, isContacted }
}
