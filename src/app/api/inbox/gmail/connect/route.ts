import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildGmailAuthUrl, getGmailRedirectUri, gmailOAuthConfigured } from '@/lib/gmail/oauth'
import crypto from 'crypto'

/** GET — redirect to Google OAuth */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (!gmailOAuthConfigured()) {
    return NextResponse.redirect(
      new URL('/dashboard/outreach?gmail=not_configured', req.url),
    )
  }

  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = getGmailRedirectUri(req.nextUrl.origin)

  const res = NextResponse.redirect(buildGmailAuthUrl(state, redirectUri))
  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  res.cookies.set('gmail_oauth_uid', user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return res
}
