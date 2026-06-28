import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import {
  exchangeGmailCode,
  fetchGmailProfile,
  getGmailRedirectUri,
  gmailOAuthConfigured,
} from '@/lib/gmail/oauth'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get('gmail_oauth_state')?.value
  const userId = req.cookies.get('gmail_oauth_uid')?.value

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/dashboard/outreach?gmail=error&reason=${encodeURIComponent(reason)}`, req.url))

  if (!gmailOAuthConfigured()) return fail('not_configured')
  if (!code || !state || state !== cookieState || !userId) return fail('invalid_state')

  try {
    const redirectUri = getGmailRedirectUri(req.nextUrl.origin)
    const tokens = await exchangeGmailCode(code, redirectUri)
    const profile = await fetchGmailProfile(tokens.access_token)
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null

    const svc = createServiceRoleClient()
    await svc.from('gmail_connections').upsert(
      {
        user_id: userId,
        email: profile.email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

    const res = NextResponse.redirect(new URL('/dashboard/outreach?gmail=connected', req.url))
    res.cookies.delete('gmail_oauth_state')
    res.cookies.delete('gmail_oauth_uid')
    return res
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'oauth_failed')
  }
}
