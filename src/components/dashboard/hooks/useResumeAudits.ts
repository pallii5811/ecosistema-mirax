'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { countPendingAudits } from '@/lib/lead-audit-status'
import { fetchMergedLeadsForSearch } from '@/lib/search-leads/read-leads'

type UseResumeAuditsOpts = {
  jobId: string | null
  isActive: boolean
  getLeads: () => unknown[]
  onLeadsUpdate: (leads: unknown[]) => void
}

/**
 * Completa audit sito pendenti (Maps streaming) via /api/resume-audits + poll Supabase.
 */
export function useResumeAudits({ jobId, isActive, getLeads, onLeadsUpdate }: UseResumeAuditsOpts) {
  const inFlightRef = useRef(false)
  const progressAtRef = useRef(Date.now())
  const getLeadsRef = useRef(getLeads)
  const onLeadsUpdateRef = useRef(onLeadsUpdate)

  useEffect(() => {
    getLeadsRef.current = getLeads
  }, [getLeads])

  useEffect(() => {
    onLeadsUpdateRef.current = onLeadsUpdate
  }, [onLeadsUpdate])

  useEffect(() => {
    if (!jobId || !isActive) return

    const syncFromDb = async (): Promise<boolean> => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('searches')
          .select('results, status')
          .eq('id', jobId)
          .single()
        if (error || !data) return false

        const merged = await fetchMergedLeadsForSearch(supabase, jobId, {
          legacyResults: data.results,
        })
        if (!Array.isArray(merged) || merged.length === 0) return false

        const current = getLeadsRef.current()
        const pendingBefore = countPendingAudits(current)
        const pendingAfter = countPendingAudits(merged)
        if (pendingAfter < pendingBefore || merged.length >= current.length) {
          progressAtRef.current = Date.now()
          onLeadsUpdateRef.current(merged)
        }
        return pendingAfter === 0
      } catch {
        return false
      }
    }

    const runResume = async () => {
      if (inFlightRef.current) return
      if (countPendingAudits(getLeadsRef.current()) === 0) return
      const stalledMs = Date.now() - progressAtRef.current
      if (stalledMs < 15_000) return

      inFlightRef.current = true
      try {
        const res = await fetch('/api/resume-audits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, batch_size: 3 }),
        })
        if (res.ok) {
          const data = await res.json()
          if (Number(data?.processed) > 0) {
            progressAtRef.current = Date.now()
          }
        }
        await syncFromDb()
      } catch {
        // retry next tick
      } finally {
        inFlightRef.current = false
      }
    }

    const syncInterval = window.setInterval(() => {
      void syncFromDb()
    }, 4000)

    const resumeKickoff = window.setTimeout(() => {
      void runResume()
    }, 6_000)

    const resumeInterval = window.setInterval(() => {
      void runResume()
    }, 12_000)

    void syncFromDb()

    return () => {
      window.clearInterval(syncInterval)
      window.clearTimeout(resumeKickoff)
      window.clearInterval(resumeInterval)
    }
  }, [jobId, isActive])
}
