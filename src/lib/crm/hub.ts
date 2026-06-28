import { createClient } from '@/utils/supabase/server'
import { dispatchLeadsToIntegration } from '@/lib/nous/dispatcher'
import { normalizeLead } from '@/lib/nous/normalizer'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'
import {
  buildMiraxCrmPayload,
  hubspotPropertiesFromMirax,
  shouldAutoCreateDeal,
  shouldAutoSyncLead,
  type CrmSyncSettings,
} from './hub-core'

export {
  buildMiraxCrmPayload,
  hubspotPropertiesFromMirax,
  shouldAutoCreateDeal,
  shouldAutoSyncLead,
  leadSyncDedupeKey,
  type CrmProvider,
  type CrmSyncSettings,
} from './hub-core'

async function createHubSpotDeal(
  accessToken: string,
  contactId: string,
  dealName: string,
  intentScore: number,
): Promise<{ ok: boolean; dealId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          dealname: dealName,
          dealstage: 'appointmentscheduled',
          description: `MIRAX hot lead — Intent ${intentScore}/100`,
        },
      }),
    })
    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
    if (!res.ok || !data?.id) {
      return { ok: false, error: data?.message || `Deal create HTTP ${res.status}` }
    }

    await fetch('https://api.hubapi.com/crm/v3/associations/deals/contacts/batch/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: [{ from: { id: data.id }, to: { id: contactId }, type: 'deal_to_contact' }],
      }),
    }).catch(() => null)

    return { ok: true, dealId: data.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Deal failed' }
  }
}

export async function syncLeadToActiveCrm(
  userId: string,
  leadInput: Record<string, unknown>,
  options?: { intentScore?: number; forceDeal?: boolean },
) {
  const supabase = await createClient()
  const intentScore = options?.intentScore ?? calculateIntentScoreFromLead(leadInput).score

  const { data: integrations } = await supabase
    .from('crm_integrations')
    .select('id, type, config, auto_sync_hot_leads, auto_create_deals, field_mapping, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)

  const rows = integrations ?? []
  const eligible = rows.filter((row) => {
    const settings: CrmSyncSettings = {
      auto_sync_hot_leads: Boolean(row.auto_sync_hot_leads),
      auto_create_deals: Boolean(row.auto_create_deals),
      field_mapping:
        row.field_mapping && typeof row.field_mapping === 'object'
          ? (row.field_mapping as Record<string, string>)
          : {},
    }
    return shouldAutoSyncLead(intentScore, settings) || options?.forceDeal
  })

  if (!eligible.length) {
    return { ok: false, skipped: true, reason: 'no_auto_sync_integration' }
  }

  const nousLead = normalizeLead(leadInput)
  nousLead.score = intentScore
  const payload = buildMiraxCrmPayload(leadInput, intentScore)
  nousLead.raw = {
    ...leadInput,
    mirax_crm_properties: hubspotPropertiesFromMirax(
      leadInput,
      payload,
      eligible[0].field_mapping as Record<string, string> | undefined,
    ),
  }

  const primary =
    eligible.find((i) => i.type === 'hubspot') ||
    eligible.find((i) => i.type === 'salesforce') ||
    eligible[0]

  const cfg =
    primary.config && typeof primary.config === 'object'
      ? (primary.config as Record<string, unknown>)
      : {}

  const dispatch = await dispatchLeadsToIntegration(supabase, {
    userId,
    integration: {
      id: String(primary.id),
      type: String(primary.type),
      config: cfg,
    },
    leads: [nousLead],
  })

  let dealId: string | undefined
  const settings: CrmSyncSettings = {
    auto_sync_hot_leads: Boolean(primary.auto_sync_hot_leads),
    auto_create_deals: Boolean(primary.auto_create_deals),
  }

  if (
    primary.type === 'hubspot' &&
    (shouldAutoCreateDeal(intentScore, settings) || options?.forceDeal)
  ) {
    const token = String(cfg.access_token || '')
    const contactId = dispatch.results.find((r) => r.external_id)?.external_id
    if (token && contactId) {
      const deal = await createHubSpotDeal(
        token,
        contactId,
        `${nousLead.nome || 'Lead MIRAX'} — Intent ${intentScore}`,
        intentScore,
      )
      dealId = deal.dealId
    }
  }

  return {
    ok: dispatch.ok,
    intentScore,
    provider: primary.type,
    contactId: dispatch.results[0]?.external_id,
    dealId,
    dispatch,
  }
}
