import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildSalesforceAuthUrl } from '@/lib/nous/adapters/salesforce'

/**
 * GET /api/crm/salesforce/oauth?integration_id=...
 * Avvia OAuth Salesforce — redirect all'authorize URL.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const integrationId = req.nextUrl.searchParams.get('integration_id') || ''
  if (!integrationId) return Response.json({ error: 'Missing integration_id' }, { status: 400 })

  const clientId = process.env.SALESFORCE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  if (!clientId) {
    return Response.json(
      { error: 'SALESFORCE_CLIENT_ID non configurato sul server' },
      { status: 503 },
    )
  }

  const { data: integration } = await supabase
    .from('crm_integrations')
    .select('id')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .eq('type', 'salesforce')
    .maybeSingle()

  if (!integration) return Response.json({ error: 'Integrazione Salesforce non trovata' }, { status: 404 })

  const redirectUri = `${appUrl.replace(/\/+$/, '')}/api/crm/salesforce/callback`
  const state = Buffer.from(JSON.stringify({ integrationId, userId: user.id })).toString('base64url')

  const url = buildSalesforceAuthUrl({ clientId, redirectUri, state })
  return Response.json({ url, redirectUri })
}
