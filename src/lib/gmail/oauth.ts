import 'server-only'

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

export function gmailOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function getGmailRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/inbox/gmail/callback`
}

export function buildGmailAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGmailCode(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed')
  }
  return data as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
}

export async function refreshGmailToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error_description || 'Refresh failed')
  return data as { access_token: string; expires_in?: number }
}

export async function fetchGmailProfile(accessToken: string): Promise<{ email: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || 'Profile fetch failed')
  return { email: String(data.emailAddress || '') }
}

export type GmailMessagePreview = {
  id: string
  threadId: string
  snippet: string
  from: string
  subject: string
  date: string
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value?.trim() || ''
}

export async function listRecentInboxMessages(accessToken: string, max = 10): Promise<GmailMessagePreview[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX&q=is:inbox newer_than:7d`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const listData = await listRes.json().catch(() => ({}))
  if (!listRes.ok) throw new Error(listData.error?.message || 'List messages failed')

  const ids: string[] = (listData.messages || []).map((m: { id: string }) => m.id).filter(Boolean)
  const previews: GmailMessagePreview[] = []

  for (const id of ids.slice(0, max)) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const msg = await msgRes.json().catch(() => ({}))
    if (!msgRes.ok) continue
    previews.push({
      id: msg.id,
      threadId: msg.threadId,
      snippet: String(msg.snippet || ''),
      from: headerValue(msg.payload?.headers, 'From'),
      subject: headerValue(msg.payload?.headers, 'Subject'),
      date: headerValue(msg.payload?.headers, 'Date'),
    })
  }

  return previews
}

export async function getMessageBodySnippet(accessToken: string, messageId: string): Promise<string> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const msg = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(msg.error?.message || 'Message fetch failed')

  const parts = msg.payload?.parts || [msg.payload]
  for (const part of parts) {
    if (part?.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data).slice(0, 4000)
    }
  }
  if (msg.payload?.body?.data) {
    return decodeBase64Url(msg.payload.body.data).slice(0, 4000)
  }
  return String(msg.snippet || '')
}
