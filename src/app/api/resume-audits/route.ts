import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { countPendingAudits, isAuditPendingLead } from '@/lib/lead-audit-status'
import {
  finalizeLeadWithoutWebsite,
  isBlankWebsite,
  leadNeedsResumeAudit,
  mergeAuditIntoLead,
} from '@/lib/merge-audit-into-lead'

const BACKEND_URL = process.env.BACKEND_URL || 'http://178.104.182.142:8001'
const AUDIT_TIMEOUT_MS = 90_000

function parseResults(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? (parsed.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
        : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeUrl(site: string): string {
  const s = site.trim()
  if (!s) return s
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return `https://${s}`
}

async function auditWebsite(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/audit-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const jobId = typeof body?.job_id === 'string' ? body.job_id.trim() : ''
    if (!jobId) return NextResponse.json({ error: 'job_id richiesto' }, { status: 400 })

    const batchSize = Math.min(4, Math.max(1, Number(body?.batch_size) || 3))

    // Cache condivisa: basta che l'utente possa leggere il job (RLS), non che ne sia il proprietario.
    const { data: readable, error: readError } = await supabase
      .from('searches')
      .select('id')
      .eq('id', jobId)
      .maybeSingle()

    if (readError || !readable?.id) {
      return NextResponse.json({ error: 'Job non trovato o non accessibile' }, { status: 404 })
    }

    const service = createServiceRoleClient()
    const { data: job, error: jobError } = await service
      .from('searches')
      .select('id, status, results')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job non trovato' }, { status: 404 })
    }

    const results = parseResults(job.results)
    if (results.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, pending: 0, total: 0, job_id: jobId })
    }

    const pendingIndexes: number[] = []
    for (let i = 0; i < results.length; i++) {
      const lead = results[i]
      if (!isAuditPendingLead(lead)) continue
      const siteRaw = String(lead.sito ?? lead.website ?? '').trim()
      if (isBlankWebsite(siteRaw)) continue
      if (!leadNeedsResumeAudit(lead)) continue
      pendingIndexes.push(i)
      if (pendingIndexes.length >= batchSize) break
    }

    const noWebsiteIndexes: number[] = []
    for (let i = 0; i < results.length && noWebsiteIndexes.length < batchSize; i++) {
      const lead = results[i]
      if (!isAuditPendingLead(lead)) continue
      const siteRaw = String(lead.sito ?? lead.website ?? '').trim()
      if (!isBlankWebsite(siteRaw)) continue
      noWebsiteIndexes.push(i)
    }

    let processed = 0
    const updated = [...results]

    for (const i of noWebsiteIndexes) {
      if (processed >= batchSize) break
      updated[i] = finalizeLeadWithoutWebsite(updated[i])
      processed++
    }

    const auditTargets = pendingIndexes.slice(0, Math.max(0, batchSize - processed))
    const auditResults = await Promise.all(
      auditTargets.map(async (i) => {
        const lead = updated[i]
        const siteRaw = String(lead.sito ?? lead.website ?? '').trim()
        const audited = await auditWebsite(normalizeUrl(siteRaw))
        return { i, audited }
      }),
    )

    for (const { i, audited } of auditResults) {
      if (audited) {
        updated[i] = mergeAuditIntoLead(updated[i], audited)
        processed++
      }
    }

    const pendingBefore = countPendingAudits(results)
    const pendingAfter = countPendingAudits(updated)

    const payload: Record<string, unknown> = { results: updated }
    if (pendingAfter === 0 && pendingBefore > 0) {
      payload.status = 'completed'
    } else if (job.status === 'completed' && pendingAfter > 0) {
      payload.status = 'processing'
    }

    if (processed > 0 || pendingAfter !== pendingBefore) {
      await service.from('searches').update(payload).eq('id', jobId)
    }

    return NextResponse.json({
      processed,
      remaining: countResumeRemaining(updated),
      pending: pendingAfter,
      total: updated.length,
      done: pendingAfter === 0,
      job_id: jobId,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore resume audit'
    console.error('[resume-audits]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function countResumeRemaining(leads: Record<string, unknown>[]): number {
  return leads.filter((l) => isAuditPendingLead(l)).length
}
