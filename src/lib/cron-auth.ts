import { NextRequest } from 'next/server'

/**
 * Verifica Bearer per endpoint cron (Vercel Cron o cron esterno).
 * Richiede esplicitamente CRON_SECRET: non usare SUPABASE_SERVICE_ROLE_KEY
 * come fallback per evitare di accoppiare l'auth cron a una chiave DB ad
 * alto privilegio.
 */
export function verifyCronBearer(req: NextRequest): { ok: true } | { ok: false; status: 401 } {
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const expected = process.env.CRON_SECRET || ''
  if (!expected || bearer !== expected) {
    return { ok: false, status: 401 }
  }
  return { ok: true }
}
