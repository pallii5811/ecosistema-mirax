import { NextRequest } from 'next/server'

/** Verifica Bearer per endpoint cron (Vercel Cron o cron esterno). */
export function verifyCronBearer(req: NextRequest): { ok: true } | { ok: false; status: 401 } {
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const cronSecret = process.env.CRON_SECRET || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const expected = cronSecret || serviceRoleKey
  if (!expected || bearer !== expected) {
    return { ok: false, status: 401 }
  }
  return { ok: true }
}
