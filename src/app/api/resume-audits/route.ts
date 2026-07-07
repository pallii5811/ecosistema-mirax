import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { runAuditResumeBatch } from '@/lib/agents/audit-agent'
import { fetchMergedLeadsForSearch } from '@/lib/search-leads/read-leads'

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

    const results = await fetchMergedLeadsForSearch(service, jobId, {
      legacyResults: job.results,
    })

    const auditResult = await runAuditResumeBatch({
      jobId,
      results,
      batchSize,
      jobStatus: String(job.status ?? ''),
    })

    if (auditResult.statusPatch) {
      await service.from('searches').update(auditResult.statusPatch).eq('id', jobId)
    }

    return NextResponse.json({
      processed: auditResult.processed,
      remaining: auditResult.remaining,
      pending: auditResult.pending,
      total: auditResult.total,
      done: auditResult.done,
      job_id: jobId,
      agent: 'audit',
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore resume audit'
    console.error('[resume-audits]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
