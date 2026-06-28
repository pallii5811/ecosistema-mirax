import { NextRequest, NextResponse } from 'next/server'
import { verifyCronBearer } from '@/lib/cron-auth'

const HEALTH_TIMEOUT_MS = 8_000

type HealthCheck = {
  url: string
  ok: boolean
  status?: number
  latency_ms?: number
  error?: string
}

async function pingHealth(baseUrl: string): Promise<HealthCheck> {
  const base = baseUrl.replace(/\/+$/, '')
  const start = Date.now()
  try {
    let res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (!res.ok) {
      res = await fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    }
    return {
      url: `${base}/health`,
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - start,
    }
  } catch (e: unknown) {
    return {
      url: `${base}/health`,
      ok: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : 'health check failed',
    }
  }
}

/**
 * GET /api/ops/worker-health
 * Monitoring base backend worker/API (Bearer CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const auth = verifyCronBearer(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const backendUrl = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
  const stagingUrl = process.env.BACKEND_STAGING_URL || backendUrl
  const prodUrl = process.env.BACKEND_PROD_URL || 'http://116.203.137.39:8001'

  const [primary, staging, prod] = await Promise.all([
    pingHealth(backendUrl),
    stagingUrl !== backendUrl ? pingHealth(stagingUrl) : Promise.resolve(null),
    prodUrl !== backendUrl && prodUrl !== stagingUrl ? pingHealth(prodUrl) : Promise.resolve(null),
  ])

  const checks = [primary, staging, prod].filter(Boolean) as HealthCheck[]
  const allOk = checks.every((c) => c.ok)
  const anyDown = checks.some((c) => !c.ok)

  return NextResponse.json({
    status: allOk ? 'healthy' : anyDown ? 'degraded' : 'unknown',
    checked_at: new Date().toISOString(),
    backend_url: backendUrl,
    checks,
    alerts: checks
      .filter((c) => !c.ok)
      .map((c) => ({ level: 'critical', message: `Backend non raggiungibile: ${c.url}`, error: c.error })),
  })
}
