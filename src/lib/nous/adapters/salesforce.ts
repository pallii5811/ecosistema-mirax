import type { AdapterDispatchInput, LeadDispatchResult, NousAdapter } from '../types.ts'

const API_VERSION = 'v59.0'

export function buildSalesforceAuthUrl(params: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: 'api refresh_token offline_access',
  })
  return `https://login.salesforce.com/services/oauth2/authorize?${q.toString()}`
}

export async function exchangeSalesforceCode(params: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ access_token: string; refresh_token?: string; instance_url: string } | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  })

  const res = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) return null
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    instance_url?: string
  }
  if (!data.access_token || !data.instance_url) return null
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    instance_url: data.instance_url.replace(/\/+$/, ''),
  }
}

export const salesforceAdapter: NousAdapter = {
  type: 'salesforce',
  async dispatch(input: AdapterDispatchInput): Promise<LeadDispatchResult[]> {
    const cfg = input.integration.config ?? {}
    const accessToken = typeof cfg.access_token === 'string' ? cfg.access_token : ''
    const instanceUrl = typeof cfg.instance_url === 'string' ? cfg.instance_url.replace(/\/+$/, '') : ''

    if (!accessToken || !instanceUrl) {
      return input.leads.map((l, index) => ({
        index,
        lead_nome: l.nome,
        status: 'error',
        error: 'Salesforce non connesso — completa OAuth',
      }))
    }

    const results: LeadDispatchResult[] = []

    for (let index = 0; index < input.leads.length; index++) {
      const lead = input.leads[index]
      try {
        const res = await fetch(`${instanceUrl}/services/data/${API_VERSION}/sobjects/Lead`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            Company: lead.nome || lead.sito || 'Lead MiraX',
            LastName: lead.nome || 'Lead',
            Email: lead.email || undefined,
            Phone: lead.telefono || undefined,
            Website: lead.sito || undefined,
            City: lead.citta || undefined,
            Description: `MiraX score ${lead.score} — ${lead.categoria}`,
            LeadSource: 'MiraX',
          }),
          signal: AbortSignal.timeout(15_000),
        })

        const data = (await res.json().catch(() => null)) as { id?: string; message?: string; error?: string } | null
        if (!res.ok) {
          results.push({
            index,
            lead_nome: lead.nome,
            status: 'error',
            error: data?.message || data?.error || `Salesforce HTTP ${res.status}`,
          })
        } else {
          results.push({
            index,
            lead_nome: lead.nome,
            status: 'success',
            external_id: data?.id,
          })
        }
      } catch (e: unknown) {
        results.push({
          index,
          lead_nome: lead.nome,
          status: 'error',
          error: e instanceof Error ? e.message : 'Salesforce request failed',
        })
      }
    }

    return results
  },
}
