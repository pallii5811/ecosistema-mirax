#!/usr/bin/env node
/** Concatena bootstrap + migration in un unico file per SQL Editor Supabase */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(ROOT, 'db/bootstrap/full_bootstrap.sql')
const files = [
  'db/bootstrap/generated_schema.sql',
  'db/bootstrap/rls_dev.sql',
  'db/migrations/2026_04_24_lists_environment_link.sql',
  'db/migrations/2026_05_24_company_lookup_cache.sql',
  'db/migrations/2026_05_24_user_openapi_unlocks.sql',
  'db/migrations/2026_06_22_outreach_log.sql',
  'db/migrations/2026_06_23_searches_zone.sql',
  'db/migrations/2026_06_25_edat_events.sql',
  'db/migrations/2026_06_26_pipeline_outreach_sync.sql',
  'db/migrations/2026_06_27_knowledge_objects.sql',
  'db/migrations/2026_06_28_ai_audit_trail.sql',
]
const parts = files.map((f) => {
  const full = path.join(ROOT, f)
  return `-- === ${f} ===\n${fs.readFileSync(full, 'utf8')}`
})
fs.writeFileSync(out, parts.join('\n\n'))
console.log('Wrote', out)
