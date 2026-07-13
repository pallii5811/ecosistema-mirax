'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useDashboard } from '@/components/DashboardContext'
import { clampSearchMaxLeads } from '@/lib/search-job-payload'

export function useCredits() {
  const { credits, setCredits } = useDashboard()
  const creditsRef = useRef(credits)

  useEffect(() => {
    creditsRef.current = credits
  }, [credits])

  const deductCredits = useCallback(
    async (amount: number, searchId?: string | null): Promise<number> => {
      if (amount <= 0) return creditsRef.current
      try {
        const res = await fetch('/api/use-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchId ? { search_id: searchId, limit: amount } : { amount }),
        })
        const data = await res.json()
        if (res.ok && typeof data.credits === 'number') {
          creditsRef.current = data.credits
          setCredits(data.credits)
          return data.credits
        }
      } catch {
        // legacy: silent fail, keep last known balance
      }
      return creditsRef.current
    },
    [setCredits],
  )

  const clampMaxLeads = useCallback(
    (value: number) => clampSearchMaxLeads(value, credits),
    [credits],
  )

  const hasCredits = credits > 0

  return {
    credits,
    creditsRef,
    deductCredits,
    clampMaxLeads,
    hasCredits,
  }
}
