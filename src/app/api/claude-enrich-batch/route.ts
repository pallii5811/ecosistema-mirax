import { NextResponse } from 'next/server'

/**
 * Retired: this legacy UI-side enrichment could issue one unmetered LLM call
 * per lead. Evidence enrichment now runs only inside the worker lifecycle,
 * behind the persistent cost governor and publication gate.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'LEGACY_UNMETERED_ENRICHMENT_RETIRED',
      replacement: 'worker_evidence_pipeline',
    },
    { status: 410 },
  )
}
