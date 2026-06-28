import { buildOpportunityString } from '../normalizer.ts'
import type { AdapterDispatchInput, LeadDispatchResult, NousAdapter, NousLead } from '../types.ts'

const SINGLE_TIMEOUT = 15_000
const BATCH_TIMEOUT = 25_000

async function postContact(accessToken: string, lead: NousLead): Promise<{ ok: boolean; id?: string; error?: string }> {
    const opp = buildOpportunityString(lead.raw)
    const miraxProps =
      lead.raw?.mirax_crm_properties && typeof lead.raw.mirax_crm_properties === 'object'
        ? (lead.raw.mirax_crm_properties as Record<string, string>)
        : {}
    const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SINGLE_TIMEOUT)

  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          company: lead.nome || '',
          website: lead.sito || '',
          phone: lead.telefono || '',
          email: lead.email || '',
          city: lead.citta || '',
          hs_lead_status: 'NEW',
          description: `Lead MiraX — Score: ${lead.score} — Opportunità: ${opp}`,
          ...miraxProps,
        },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
    if (!res.ok) return { ok: false, error: data?.message || `HubSpot error (HTTP ${res.status})` }
    return { ok: true, id: data?.id }
  } catch (err: unknown) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Timeout HubSpot'
        : err instanceof Error
          ? err.message
          : 'HubSpot failed'
    return { ok: false, error: msg }
  }
}

export const hubspotAdapter: NousAdapter = {
  type: 'hubspot',
  async dispatch(input: AdapterDispatchInput): Promise<LeadDispatchResult[]> {
    const accessToken =
      typeof input.integration.config?.access_token === 'string'
        ? input.integration.config.access_token
        : ''

    if (!accessToken) {
      return input.leads.map((l, index) => ({
        index,
        lead_nome: l.nome,
        status: 'error',
        error: 'Missing HubSpot access token',
      }))
    }

    const results: LeadDispatchResult[] = []
    const withEmail = input.leads.map((l, index) => ({ l, index })).filter((x) => x.l.email)
    const withoutEmail = input.leads.map((l, index) => ({ l, index })).filter((x) => !x.l.email)

    if (withEmail.length > 0) {
      try {
        const upsertBody = {
          inputs: withEmail.map(({ l }) => ({
            idProperty: 'email',
            id: l.email,
            properties: {
              email: l.email,
              company: l.nome || '',
              website: l.sito || '',
              phone: l.telefono || '',
              city: l.citta || '',
              hs_lead_status: 'NEW',
              description: `Lead MiraX — Score: ${l.score} — Opportunità: ${buildOpportunityString(l.raw)}`,
              ...(l.raw?.mirax_crm_properties && typeof l.raw.mirax_crm_properties === 'object'
                ? (l.raw.mirax_crm_properties as Record<string, string>)
                : {}),
            },
          })),
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT)
        const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(upsertBody),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))

        const data = (await res.json().catch(() => null)) as { results?: Array<{ id?: string; properties?: { email?: string } }>; message?: string } | null

        if (res.ok || res.status === 207) {
          const byEmail = new Map<string, string>()
          for (const r of data?.results ?? []) {
            const e = (r?.properties?.email || '').toLowerCase()
            if (e && r?.id) byEmail.set(e, r.id)
          }
          for (const { l, index } of withEmail) {
            results.push({
              index,
              lead_nome: l.nome,
              status: 'success',
              external_id: byEmail.get(l.email),
            })
          }
        } else {
          const msg = data?.message || `HubSpot batch upsert error (HTTP ${res.status})`
          for (const { l, index } of withEmail) {
            results.push({ index, lead_nome: l.nome, status: 'error', error: msg })
          }
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error && err.name === 'AbortError'
            ? 'Timeout HubSpot'
            : err instanceof Error
              ? err.message
              : 'HubSpot batch failed'
        for (const { l, index } of withEmail) {
          results.push({ index, lead_nome: l.nome, status: 'error', error: msg })
        }
      }
    }

    for (const { l, index } of withoutEmail) {
      const r = await postContact(accessToken, l)
      results.push({
        index,
        lead_nome: l.nome,
        status: r.ok ? 'success' : 'error',
        error: r.error,
        external_id: r.id,
      })
    }

    return results.sort((a, b) => a.index - b.index)
  },
}
