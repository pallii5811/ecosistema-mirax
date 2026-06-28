import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { exchangeSalesforceCode } from '@/lib/nous/adapters/salesforce'

/**
 * GET /api/crm/salesforce/callback?code=...&state=...
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const stateRaw = req.nextUrl.searchParams.get('state')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, '')
  const redirectOk = `${appUrl}/dashboard/integrations/crm?salesforce=connected`
  const redirectErr = `${appUrl}/dashboard/integrations/crm?salesforce=error`

  if (!code || !stateRaw) {
    return Response.redirect(redirectErr)
  }

  let state: { integrationId?: string; userId?: string }
  try {
    state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'))
  } catch {
    return Response.redirect(redirectErr)
  }

  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  if (!clientId || !clientSecret || !state.integrationId || !state.userId) {
    return Response.redirect(redirectErr)
  }

  const redirectUri = `${appUrl}/api/crm/salesforce/callback`
  const tokens = await exchangeSalesforceCode({
    code,
    clientId,
    clientSecret,
    redirectUri,
  })

  if (!tokens) return Response.redirect(redirectErr)

  const supabase = await createClient()
  const { error } = await supabase
    .from('crm_integrations')
    .update({
      config: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        instance_url: tokens.instance_url,
        connected_at: new Date().toISOString(),
      },
      is_active: true,
      last_sync_at: new Date().toISOString(),
    })
    .eq('id', state.integrationId)
    .eq('user_id', state.userId)
    .eq('type', 'salesforce')

  if (error) return Response.redirect(redirectErr)
  return Response.redirect(redirectOk)
}
