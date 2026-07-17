import { NextResponse } from 'next/server'

import { COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION } from '@/lib/contracts/commercial-search-plan'
import { COMMERCIAL_INTENT_PROMPT_VERSION } from '@/lib/intent-compiler/compile-commercial-search-plan'
import { SIGNAL_ONTOLOGY, SIGNAL_ONTOLOGY_VERSION } from '@/lib/signal-ontology/ontology'
import { SOURCE_REGISTRY } from '@/lib/source-intelligence/registry'
import { STAGE1_CAPABILITY_MATRIX } from '@/lib/stage1-capabilities'

export const dynamic = 'force-dynamic'

export const MIRAX_RELEASE_ID = '20260717_stage1_capability_truthfulness' as const

function enabledFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

export async function GET() {
  return NextResponse.json(
    {
      release_id: MIRAX_RELEASE_ID,
      stage: 'stage1',
      git_sha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.MIRAX_RELEASE_SHA || null,
      commercial_plan_schema: COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
      intent_prompt: COMMERCIAL_INTENT_PROMPT_VERSION,
      source_registry_schema: SOURCE_REGISTRY.schema_version,
      source_class_count: SOURCE_REGISTRY.sources.length,
      signal_ontology_schema: SIGNAL_ONTOLOGY_VERSION,
      signal_count: SIGNAL_ONTOLOGY.length,
      production_search_disabled: enabledFlag(process.env.MIRAX_SEARCH_DISABLED),
      production_worker_disabled: enabledFlag(process.env.MIRAX_WORKER_DISABLED),
      stage1_capabilities: STAGE1_CAPABILITY_MATRIX,
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
