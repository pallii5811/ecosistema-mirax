import type { SupabaseClient } from '@supabase/supabase-js'
import { NOUS_EVENTS } from './events.ts'
import { getNousAdapter } from './registry.ts'
import type { CrmIntegrationRow, DispatchLeadsResult, NousLead } from './types.ts'

export type DispatchToIntegrationParams = {
  userId: string
  integration: CrmIntegrationRow
  event?: string
  leads: NousLead[]
}

async function writeSyncLog(
  supabase: SupabaseClient,
  userId: string,
  integrationId: string,
  leads: NousLead[],
  results: Array<{ index: number; status: string; error?: string }>,
): Promise<void> {
  const rows = results.map((r) => {
    const l = leads[r.index]
    return {
      user_id: userId,
      integration_id: integrationId,
      lead_website: l?.sito || null,
      lead_nome: l?.nome || null,
      status: r.status === 'success' ? 'success' : 'error',
      error_message: r.status === 'success' ? null : r.error || 'error',
    }
  })
  if (rows.length > 0) await supabase.from('crm_sync_log').insert(rows)
}

export async function dispatchLeadsToIntegration(
  supabase: SupabaseClient,
  params: DispatchToIntegrationParams,
): Promise<DispatchLeadsResult> {
  const { userId, integration, leads } = params
  const adapter = getNousAdapter(integration.type)

  if (!adapter) {
    const results = leads.map((l, index) => ({
      index,
      lead_nome: l.nome,
      status: 'error' as const,
      error: `Tipo CRM "${integration.type}" non supportato`,
    }))
    return { ok: false, total: leads.length, success: 0, failed: leads.length, results }
  }

  const event =
    params.event ??
    (leads.length === 1 ? NOUS_EVENTS.LEAD_EXPORTED : NOUS_EVENTS.LEADS_EXPORTED)

  const results = await adapter.dispatch({ integration, event, leads })
  const success = results.filter((r) => r.status === 'success').length

  await writeSyncLog(supabase, userId, integration.id, leads, results)

  if (success > 0) {
    const currentSynced =
      typeof integration.leads_synced === 'number' ? integration.leads_synced : 0
    await supabase
      .from('crm_integrations')
      .update({ leads_synced: currentSynced + success, last_sync_at: new Date().toISOString() })
      .eq('id', integration.id)
      .eq('user_id', userId)
  }

  return {
    ok: success > 0,
    total: leads.length,
    success,
    failed: leads.length - success,
    results,
  }
}

export async function loadCrmIntegration(
  supabase: SupabaseClient,
  userId: string,
  integrationId: string,
  expectedType?: string,
  options?: { requireActive?: boolean },
): Promise<CrmIntegrationRow | null> {
  let q = supabase
    .from('crm_integrations')
    .select('id, type, config, leads_synced')
    .eq('id', integrationId)
    .eq('user_id', userId)

  if (options?.requireActive) q = q.eq('is_active', true)

  if (expectedType) q = q.eq('type', expectedType)

  const { data } = await q.maybeSingle()
  if (!data) return null

  const cfg =
    (data as { config?: unknown }).config && typeof (data as { config?: unknown }).config === 'object'
      ? ((data as { config: Record<string, unknown> }).config as Record<string, unknown>)
      : {}

  return {
    id: String((data as { id: string }).id),
    type: String((data as { type: string }).type),
    config: cfg,
    leads_synced: (data as { leads_synced?: number }).leads_synced,
  }
}
