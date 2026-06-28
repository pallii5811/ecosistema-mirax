import { MIRAX_API_VERSION } from '@/lib/jarvis-api-catalog'

export async function GET() {
  return Response.json({
    ok: true,
    service: 'mirax-api',
    version: MIRAX_API_VERSION,
    docs: '/dashboard/integrations/api-keys',
    timestamp: new Date().toISOString(),
  })
}
