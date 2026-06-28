/**
 * Audit Agent — batch resume audit (estratto da /api/resume-audits).
 */

import { countPendingAudits, isAuditPendingLead } from '@/lib/lead-audit-status'
import {
  finalizeLeadWithoutWebsite,
  isBlankWebsite,
  leadNeedsResumeAudit,
  mergeAuditIntoLead,
} from '@/lib/merge-audit-into-lead'

export type AuditResumeInput = {
  jobId: string
  results: Record<string, unknown>[]
  batchSize?: number
  backendUrl?: string
  auditTimeoutMs?: number
  jobStatus?: string
}

export type AuditResumeResult = {
  processed: number
  remaining: number
  pending: number
  total: number
  done: boolean
  results: Record<string, unknown>[]
  statusPatch?: Record<string, unknown>
}

function normalizeUrl(site: string): string {
  const s = site.trim()
  if (!s) return s
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return `https://${s}`
}

export async function auditWebsite(
  url: string,
  backendUrl: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${backendUrl}/audit-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function countResumeRemaining(leads: Record<string, unknown>[]): number {
  return leads.filter((l) => isAuditPendingLead(l)).length
}

export async function runAuditResumeBatch(input: AuditResumeInput): Promise<AuditResumeResult> {
  const backendUrl = input.backendUrl || process.env.BACKEND_URL || 'http://116.203.137.39:8002'
  const timeoutMs = input.auditTimeoutMs ?? 90_000
  const batchSize = Math.min(4, Math.max(1, Number(input.batchSize) || 3))

  const results = [...input.results]
  if (results.length === 0) {
    return {
      processed: 0,
      remaining: 0,
      pending: 0,
      total: 0,
      done: true,
      results,
    }
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
      const audited = await auditWebsite(normalizeUrl(siteRaw), backendUrl, timeoutMs)
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

  const statusPatch: Record<string, unknown> = { results: updated }
  if (pendingAfter === 0 && pendingBefore > 0) {
    statusPatch.status = 'completed'
  } else if (input.jobStatus === 'completed' && pendingAfter > 0) {
    statusPatch.status = 'processing'
  }

  return {
    processed,
    remaining: countResumeRemaining(updated),
    pending: pendingAfter,
    total: updated.length,
    done: pendingAfter === 0,
    results: updated,
    statusPatch: processed > 0 || pendingAfter !== pendingBefore ? statusPatch : undefined,
  }
}
