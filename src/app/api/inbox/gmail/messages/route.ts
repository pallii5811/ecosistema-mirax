import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import {
  getMessageBodySnippet,
  gmailOAuthConfigured,
  listRecentInboxMessages,
  refreshGmailToken,
} from '@/lib/gmail/oauth'

async function getValidAccessToken(userId: string): Promise<{ token: string; email: string } | null> {
  const svc = createServiceRoleClient()
  const { data, error } = await svc
    .from('gmail_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null

  let token = data.access_token as string
  const expires = data.token_expires_at ? Date.parse(String(data.token_expires_at)) : 0
  const needsRefresh = expires > 0 && Date.now() > expires - 60_000

  if (needsRefresh && data.refresh_token) {
    try {
      const refreshed = await refreshGmailToken(String(data.refresh_token))
      token = refreshed.access_token
      await svc
        .from('gmail_connections')
        .update({
          access_token: token,
          token_expires_at: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
    } catch {
      return null
    }
  }

  return { token, email: String(data.email) }
}

/** GET — stato connessione + messaggi recenti */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!gmailOAuthConfigured()) {
    return NextResponse.json({ configured: false, connected: false, messages: [] })
  }

  const session = await getValidAccessToken(user.id)
  if (!session) {
    return NextResponse.json({ configured: true, connected: false, messages: [] })
  }

  try {
    const messages = await listRecentInboxMessages(session.token, 8)
    return NextResponse.json({
      configured: true,
      connected: true,
      email: session.email,
      messages,
    })
  } catch (e) {
    return NextResponse.json({
      configured: true,
      connected: true,
      email: session.email,
      messages: [],
      error: e instanceof Error ? e.message : 'fetch_failed',
    })
  }
}

/** POST — body completo di un messaggio per classificazione */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { messageId?: string } | null
  const messageId = body?.messageId?.trim()
  if (!messageId) return NextResponse.json({ error: 'messageId richiesto' }, { status: 400 })

  const session = await getValidAccessToken(user.id)
  if (!session) return NextResponse.json({ error: 'Gmail non connesso' }, { status: 400 })

  const text = await getMessageBodySnippet(session.token, messageId)
  return NextResponse.json({ body: text })
}

/** DELETE — disconnetti Gmail */
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceRoleClient()
  await svc.from('gmail_connections').delete().eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
