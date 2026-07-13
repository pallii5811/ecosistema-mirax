import { NextResponse } from 'next/server'

import { COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION } from '@/lib/contracts/commercial-search-plan'
import { COMMERCIAL_INTENT_PROMPT_VERSION } from '@/lib/intent-compiler/compile-commercial-search-plan'
import { SIGNAL_ONTOLOGY, SIGNAL_ONTOLOGY_VERSION } from '@/lib/signal-ontology/ontology'
import { SOURCE_REGISTRY } from '@/lib/source-intelligence/registry'

export const dynamic = 'force-dynamic'

export const MIRAX_RELEASE_ID = '2026-07-13-complete-signal-lane-coverage-v5-11' as const

function enabledFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

export async function GET() {
  return NextResponse.json(
    {
      release_id: MIRAX_RELEASE_ID,
      commercial_plan_schema: COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
      intent_prompt: COMMERCIAL_INTENT_PROMPT_VERSION,
      source_registry_schema: SOURCE_REGISTRY.schema_version,
      source_class_count: SOURCE_REGISTRY.sources.length,
      signal_ontology_schema: SIGNAL_ONTOLOGY_VERSION,
      signal_count: SIGNAL_ONTOLOGY.length,
      production_search_disabled: enabledFlag(process.env.MIRAX_SEARCH_DISABLED),
      runtime: 'vercel-nextjs',
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-MIRAX-Release': MIRAX_RELEASE_ID,
      },
    },
  )
}
