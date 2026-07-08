/**
 * Realtime + polling ibrido su job discovery.
 * Idle timeout: 3 min senza UPDATE → timeout (con risultati parziali se presenti).
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { fetchMergedLeadsForSearch, parseLegacySearchResults } from '@/lib/search-leads/read-leads'

export type SearchRealtimeStatus =
  | 'pending'
  | 'running'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'timeout'
  | string

export type SearchRealtimeUpdate = {
  status: SearchRealtimeStatus
  results: unknown[]
  updated_at?: string
  heartbeat_at?: string
  user_message?: string | null
  progress?: SearchJobProgress | null
}

export type SearchJobProgress = {
  phase?: string
  found?: number
  target?: number
  pages_scraped?: number
  page_budget?: number
  rounds?: number
  unique_urls?: number
  llm_requests?: number
  cache_hits?: number
  estimated_llm_cost_usd?: number
  stop_reason?: string
  updated_at?: string
}

function parseProgress(value: unknown): SearchJobProgress | null {
  return value && typeof value === 'object' ? (value as SearchJobProgress) : null
}

function userMessageFromIntent(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object') return null
  const msg = (intent as Record<string, unknown>).completion_user_message
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null
}

/** Nessun UPDATE per 3 min → idle timeout */
const IDLE_TIMEOUT_MS = 180_000
/** Safety net assoluto (30 min) */
const ABSOLUTE_MAX_MS = 1_800_000
const POLL_INTERVAL_MS = 8_000

async function pollJobViaApi(searchId: string): Promise<SearchRealtimeUpdate | null> {
  try {
    const res = await fetch(`/api/check-scrape-job?job_id=${encodeURIComponent(searchId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      status?: string
      results?: unknown[]
      updated_at?: string
      heartbeat_at?: string
      user_message?: string | null
      progress?: SearchJobProgress | null
    }
    return {
      status: String(data.status ?? 'pending'),
      results: Array.isArray(data.results) ? data.results : [],
      updated_at: data.updated_at ? String(data.updated_at) : undefined,
      heartbeat_at: data.heartbeat_at ? String(data.heartbeat_at) : undefined,
      user_message: data.user_message ?? null,
      progress: parseProgress(data.progress),
    }
  } catch (e) {
    console.warn('[search-realtime] poll failed:', e)
    return null
  }
}

export function useSearchRealtime(
  searchId: string | null | undefined,
  callbacks: {
    onUpdate?: (update: SearchRealtimeUpdate) => void
    onDone?: (update: SearchRealtimeUpdate) => void
    onError?: (update: SearchRealtimeUpdate) => void
    onTimeout?: (update: SearchRealtimeUpdate) => void
  } = {},
) {
  const [connected, setConnected] = useState(false)
  const callbacksRef = useRef(callbacks)
  const doneRef = useRef(false)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    if (!searchId) {
      doneRef.current = false
      return
    }

    doneRef.current = false
    const supabase = createClient()
    let idleTimeout: ReturnType<typeof setTimeout> | null = null
    let absoluteTimeout: ReturnType<typeof setTimeout> | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let lastResultCount = -1
    let lastUpdatedAt = ''
    let lastHeartbeatAt = ''

    const cleanup = (channel: ReturnType<typeof supabase.channel> | null) => {
      if (idleTimeout) {
        clearTimeout(idleTimeout)
        idleTimeout = null
      }
      if (absoluteTimeout) {
        clearTimeout(absoluteTimeout)
        absoluteTimeout = null
      }
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
      if (channel) void supabase.removeChannel(channel)
      setConnected(false)
    }

    const finish = (channel: ReturnType<typeof supabase.channel> | null) => {
      if (doneRef.current) return
      doneRef.current = true
      cleanup(channel)
    }

    const emitUpdate = (
      update: SearchRealtimeUpdate,
      channel: ReturnType<typeof supabase.channel> | null,
    ) => {
      const status = update.status

      if (status === 'completed') {
        finish(channel)
        callbacksRef.current.onDone?.(update)
        return
      }

      if (status === 'error' || status === 'cancelled') {
        finish(channel)
        callbacksRef.current.onError?.(update)
        return
      }

      callbacksRef.current.onUpdate?.(update)
    }

    const noteActivity = (update: SearchRealtimeUpdate) => {
      const count = update.results.length
      const ts = update.updated_at ?? ''
      const heartbeat = update.heartbeat_at ?? ''
      const countChanged = count !== lastResultCount
      const tsChanged = ts && ts !== lastUpdatedAt
      const heartbeatChanged = heartbeat && heartbeat !== lastHeartbeatAt

      if (countChanged || tsChanged || heartbeatChanged) {
        lastResultCount = count
        if (ts) lastUpdatedAt = ts
        if (heartbeat) lastHeartbeatAt = heartbeat
        resetIdleTimer()
      }
    }

    const handleIdleTimeout = async (channel: ReturnType<typeof supabase.channel> | null) => {
      if (doneRef.current) return
      const final = await pollJobViaApi(searchId)
      if (
        final &&
        (final.status === 'completed' || final.status === 'error' || final.status === 'cancelled')
      ) {
        emitUpdate(final, channel)
        return
      }
      if (doneRef.current) return
      doneRef.current = true
      callbacksRef.current.onTimeout?.({
        status: 'timeout',
        results: final?.results ?? [],
        updated_at: final?.updated_at,
      })
      cleanup(channel)
    }

    const resetIdleTimer = () => {
      if (idleTimeout) clearTimeout(idleTimeout)
      idleTimeout = setTimeout(() => {
        void handleIdleTimeout(channel)
      }, IDLE_TIMEOUT_MS)
    }

    const dispatchUpdate = async (
      row: Record<string, unknown>,
      channel: ReturnType<typeof supabase.channel> | null,
    ) => {
      if (doneRef.current) return

      const status = String(row.status ?? 'pending')
      const updated_at = row.updated_at ? String(row.updated_at) : undefined
      const heartbeat_at = row.heartbeat_at ? String(row.heartbeat_at) : undefined

      let results: unknown[] = []
      try {
        results = await fetchMergedLeadsForSearch(supabase, searchId, {
          legacyResults: row.results,
        })
      } catch (e) {
        console.warn('[search-realtime] fetchMergedLeadsForSearch failed:', e)
        results = parseLegacySearchResults(row.results)
      }

      if (results.length === 0 && row.results) {
        results = parseLegacySearchResults(row.results)
      }

      const update: SearchRealtimeUpdate = {
        status,
        results,
        updated_at,
        heartbeat_at,
        progress: parseProgress(row.progress),
      }
      const intentMsg = userMessageFromIntent(row.intent)
      if (intentMsg) update.user_message = intentMsg
      noteActivity(update)
      emitUpdate(update, channel)
    }

    const pollAndDispatch = async (channel: ReturnType<typeof supabase.channel> | null) => {
      if (doneRef.current) return
      const polled = await pollJobViaApi(searchId)
      if (!polled || doneRef.current) return
      noteActivity(polled)
      emitUpdate(polled, channel)
    }

    const fetchSnapshot = async (channel: ReturnType<typeof supabase.channel> | null) => {
      try {
        const { data, error } = await supabase
          .from('searches')
          .select('*')
          .eq('id', searchId)
          .single()
        if (error || !data || doneRef.current) return
        await dispatchUpdate(data as Record<string, unknown>, channel)
      } catch {
        // ignore
      }
    }

    const channel = supabase
      .channel(`search-job-${searchId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'searches',
          filter: `id=eq.${searchId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined
          if (row) void dispatchUpdate(row, channel)
        },
      )
      .subscribe((status) => {
        const isSubscribed = status === 'SUBSCRIBED'
        setConnected(isSubscribed)
        if (isSubscribed) {
          void fetchSnapshot(channel)
          void pollAndDispatch(channel)
          resetIdleTimer()
        }
      })

    pollInterval = setInterval(() => {
      void pollAndDispatch(channel)
    }, POLL_INTERVAL_MS)

    absoluteTimeout = setTimeout(() => {
      void handleIdleTimeout(channel)
    }, ABSOLUTE_MAX_MS)

    return () => {
      doneRef.current = true
      cleanup(channel)
    }
  }, [searchId])

  return { connected }
}
