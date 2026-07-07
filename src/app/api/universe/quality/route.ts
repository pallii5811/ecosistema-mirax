/**
 * GET /api/universe/quality
 * Returns Knowledge Graph health and search quality metrics.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import {
  getUniverseQualityMetrics,
  getSearchQualityMetrics,
  getUserLearningMetrics,
} from '@/lib/universe/quality'
import { universeClientError } from '@/lib/universe/errors'

export async function GET() {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const sb = await createClient()
    const [universe, search, learning] = await Promise.all([
      getUniverseQualityMetrics(sb),
      getSearchQualityMetrics(sb, auth.userId),
      getUserLearningMetrics(sb, auth.userId),
    ])

    return NextResponse.json({ ok: true, universe, search, learning })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'quality')
    return NextResponse.json({ error: message }, { status })
  }
}
