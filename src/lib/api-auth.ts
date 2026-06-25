import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createServiceRoleClient, createClient } from '@/utils/supabase/server'

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = 'mx_' + crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const prefix = key.substring(0, 11)
  return { key, hash, prefix }
}

export async function authenticateApiKey(req: NextRequest): Promise<{ userId: string | null; error: string | null }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { userId: null, error: 'Missing or invalid Authorization header' }
  }

  const key = authHeader.substring(7).trim()
  if (!key) return { userId: null, error: 'Missing or invalid Authorization header' }

  const hash = crypto.createHash('sha256').update(key).digest('hex')

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('user_id, is_active, requests_count')
    .eq('key_hash', hash)
    .maybeSingle()

  if (error || !data || data.is_active !== true) {
    return { userId: null, error: 'Invalid or inactive API key' }
  }

  const nextCount = (typeof (data as any).requests_count === 'number' ? (data as any).requests_count : 0) + 1

  try {
    await supabase
      .from('api_keys')
      .update({ requests_count: nextCount, last_used_at: new Date().toISOString() })
      .eq('key_hash', hash)
  } catch {
    // ignore
  }

  return { userId: String((data as any).user_id), error: null }
}

export function apiResponse(data: any, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function apiError(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export async function requireUserSession() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}
