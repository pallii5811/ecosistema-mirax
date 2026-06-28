import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWebsite } from '@/lib/outreach'
import {
  mergePipelineStage,
  outreachStatusToPipelineStage,
  sanitizePipelineStage,
} from '@/lib/pipeline-stages'

export type OutreachSyncPayload = {
  outreachId?: string | null
  leadName?: string | null
  leadWebsite?: string | null
  channel: string
  status: string
  leadScore?: number | null
  leadPhone?: string | null
  leadEmail?: string | null
  leadCity?: string | null
  leadCategory?: string | null
}

export type PipelineSyncResult = {
  synced: boolean
  created: boolean
  pipelineId?: string
  stage?: string
  skipped?: boolean
  reason?: string
}

async function findPipelineByLead(
  supabase: SupabaseClient,
  userId: string,
  website: string | null | undefined,
  name: string | null | undefined,
) {
  const web = normalizeWebsite(website ?? null)
  const nm = name?.trim().toLowerCase() ?? ''

  const { data, error } = await supabase
    .from('lead_pipeline')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error || !data) return null

  if (web) {
    const hit = data.find((row) => normalizeWebsite(row.lead_website) === web)
    if (hit) return hit
  }
  if (nm) {
    const hit = data.find((row) => String(row.lead_name ?? '').trim().toLowerCase() === nm)
    if (hit) return hit
  }
  return null
}

function buildOutreachNote(channel: string, status: string): string {
  return `Outreach ${status} via ${channel} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
}

/**
 * Sincronizza outreach_log → lead_pipeline (auto-create o avanzamento stage).
 */
export async function syncPipelineFromOutreach(
  supabase: SupabaseClient,
  userId: string,
  payload: OutreachSyncPayload,
): Promise<PipelineSyncResult> {
  const status = payload.status.trim().toLowerCase()
  const shouldSync = ['sent', 'interested', 'not_interested', 'replied', 'no_answer'].includes(status)
  if (!shouldSync) {
    return { synced: false, skipped: true, reason: 'status_not_syncable', created: false }
  }

  const name = payload.leadName?.trim()
  if (!name && !payload.leadWebsite) {
    return { synced: false, skipped: true, reason: 'missing_identity', created: false }
  }

  const existing = await findPipelineByLead(supabase, userId, payload.leadWebsite, name)
  const now = new Date().toISOString()
  const proposed = outreachStatusToPipelineStage(status, existing?.stage ?? 'nuovo')

  const outreachMeta = {
    last_outreach_channel: payload.channel,
    last_outreach_at: now,
    last_outreach_status: status,
    ...(payload.outreachId ? { source_outreach_id: payload.outreachId } : {}),
  }

  if (!existing) {
    if (status !== 'sent' && status !== 'interested' && status !== 'replied') {
      return { synced: false, skipped: true, reason: 'no_pipeline_for_outcome', created: false }
    }
    const stage = mergePipelineStage('nuovo', proposed ?? 'contattato')
    const { data, error } = await supabase
      .from('lead_pipeline')
      .insert({
        user_id: userId,
        lead_name: name || payload.leadWebsite || 'Lead',
        lead_website: payload.leadWebsite ?? null,
        lead_phone: payload.leadPhone ?? null,
        lead_email: payload.leadEmail ?? null,
        lead_city: payload.leadCity ?? null,
        lead_category: payload.leadCategory ?? null,
        lead_score: typeof payload.leadScore === 'number' ? Math.round(payload.leadScore) : 0,
        stage,
        deal_value: 0,
        notes: buildOutreachNote(payload.channel, status),
        ...outreachMeta,
        updated_at: now,
      })
      .select('id, stage')
      .single()

    if (error) {
      return { synced: false, created: false, reason: error.message }
    }
    return {
      synced: true,
      created: true,
      pipelineId: data?.id as string,
      stage: data?.stage as string,
    }
  }

  const mergedStage = mergePipelineStage(existing.stage, proposed)
  const prevNotes = typeof existing.notes === 'string' ? existing.notes : ''
  const noteLine = buildOutreachNote(payload.channel, status)
  const notes =
    prevNotes && !prevNotes.includes(noteLine.slice(0, 20))
      ? `${prevNotes}\n${noteLine}`.slice(0, 5000)
      : prevNotes || noteLine

  const { data, error } = await supabase
    .from('lead_pipeline')
    .update({
      stage: mergedStage,
      notes,
      ...outreachMeta,
      updated_at: now,
    })
    .eq('id', existing.id)
    .eq('user_id', userId)
    .select('id, stage')
    .single()

  if (error) {
    return { synced: false, created: false, reason: error.message }
  }

  const changed = sanitizePipelineStage(existing.stage) !== sanitizePipelineStage(mergedStage)
  return {
    synced: changed || status === 'sent',
    created: false,
    pipelineId: data?.id as string,
    stage: data?.stage as string,
  }
}
