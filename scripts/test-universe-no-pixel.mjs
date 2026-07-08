#!/usr/bin/env node
/** Regression: JSONB boolean false must remain queryable in Universe. */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  for (const name of ['.env.local', '.env.ecosistema.secrets']) {
    const file = path.join(ROOT, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index <= 0 || line.trim().startsWith('#')) continue
      const key = line.slice(0, index).trim()
      const value = line.slice(index + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  }
}

loadEnv()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Supabase test credentials missing')

const sb = createClient(url, key)
const { executeUniverseQuery, fetchEntityIdsByObservation } = await import('../src/lib/universe/query-builder.ts')

try {
  const ids = await fetchEntityIdsByObservation(sb, {
    attribute: 'meta_pixel',
    operator: 'eq',
    value: false,
  })
  if (!Array.isArray(ids)) throw new Error('Expected an array of entity ids')
  if (ids.length < 1_000) throw new Error(`Scale fixture too small: expected >=1000 ids, got ${ids.length}`)

  const { data: relationshipRows, error: relationshipError } = await sb
    .from('universe_relationships')
    .select('relationship_type')
    .limit(1)
  if (relationshipError) throw relationshipError
  if (relationshipRows?.length) {
    const impossibleTarget = await executeUniverseQuery(sb, {
      entity_type: 'company',
      relationships: [
        {
          relationship_type: relationshipRows[0].relationship_type,
          direction: 'outgoing',
          target_filters: { name_contains: '__mirax_target_that_cannot_exist_7f3a9d__' },
        },
      ],
      limit: 10,
    })
    if (impossibleTarget.total !== 0 || impossibleTarget.entities.length !== 0) {
      throw new Error('An unresolved relationship target must produce zero entities')
    }
  }

  console.log('test-universe-scale: OK (' + ids.length + ' JSONB=false entities, target guard OK)')
} catch (error) {
  console.error('test-universe-no-pixel: FAIL', {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    cause: error?.cause,
  })
  process.exit(1)
}
