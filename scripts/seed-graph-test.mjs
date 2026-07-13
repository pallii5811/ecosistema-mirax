#!/usr/bin/env node
/**
 * Seed a tiny test graph to validate multi-hop / relation reasoning end-to-end.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}
function loadEnv() {
  for (const p of [path.join(ROOT, '.env.local'), path.join(ROOT, '.env.ecosistema.secrets')]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return env
  }
  throw new Error('env')
}
const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function upsertEntity(canonicalId, type, name, city) {
  const { data, error } = await sb
    .from('universe_entities')
    .upsert(
      {
        canonical_id: canonicalId,
        entity_type: type,
        name,
        slug: canonicalId,
        city,
        country: 'IT',
        confidence: 1,
      },
      { onConflict: 'canonical_id,entity_type' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

function relationshipDedupKey(src, tgt, type) {
  return `${src}:${tgt}:${type}`
}

async function upsertRelationship(src, tgt, type, source = 'test_seed') {
  const { error } = await sb.from('universe_relationships').upsert(
    {
      source_entity_id: src,
      target_entity_id: tgt,
      relationship_type: type,
      source,
      observed_at: new Date().toISOString(),
      confidence: 0.9,
      dedup_key: relationshipDedupKey(src, tgt, type),
    },
    { onConflict: 'source_entity_id,target_entity_id,relationship_type' },
  )
  if (error) throw error
}

export async function seedGraphTest() {
  const target = await upsertEntity('test-target-cliente', 'company', 'Cliente Target Srl', 'Milano')
  const supplierA = await upsertEntity('test-supplier-alpha', 'company', 'Fornitore Alpha Srl', 'Milano')
  const supplierB = await upsertEntity('test-supplier-beta', 'company', 'Fornitore Beta Srl', 'Milano')
  const competitor = await upsertEntity('test-competitor-gamma', 'company', 'Competitor Gamma Srl', 'Milano')
  const partner = await upsertEntity('test-partner-delta', 'company', 'Partner Delta Srl', 'Milano')
  const customer = await upsertEntity('test-customer-mio', 'company', 'Mio Cliente Srl', 'Milano')
  const customerCompetitor = await upsertEntity('test-customer-competitor', 'company', 'Competitor di Mio Cliente Srl', 'Milano')

  // Target buys from suppliers
  await upsertRelationship(target, supplierA, 'buys_from')
  await upsertRelationship(supplierA, target, 'sells_to')
  await upsertRelationship(target, supplierB, 'buys_from')
  await upsertRelationship(supplierB, target, 'sells_to')

  // Target has a customer
  await upsertRelationship(target, customer, 'has_customer')
  await upsertRelationship(customer, target, 'customer_of')

  // Competitor
  await upsertRelationship(target, competitor, 'competes_with')
  await upsertRelationship(competitor, target, 'competes_with')

  // Partner
  await upsertRelationship(target, partner, 'partner_of')
  await upsertRelationship(partner, target, 'partner_of')

  // Competitor of customer
  await upsertRelationship(customer, customerCompetitor, 'competes_with')
  await upsertRelationship(customerCompetitor, customer, 'competes_with')

  return { target, supplierA, supplierB, competitor, partner, customer, customerCompetitor }
}

export async function cleanupGraphTest() {
  const cids = [
    'test-target-cliente',
    'test-supplier-alpha',
    'test-supplier-beta',
    'test-competitor-gamma',
    'test-partner-delta',
    'test-customer-mio',
    'test-customer-competitor',
  ]
  const { data } = await sb.from('universe_entities').select('id').in('canonical_id', cids)
  const ids = (data || []).map((d) => d.id)
  if (ids.length) {
    await sb.from('universe_relationships').delete().or(`source_entity_id.in.(${ids}),target_entity_id.in.(${ids})`)
    await sb.from('universe_entities').delete().in('id', ids)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = await seedGraphTest()
  console.log('seeded test graph', ids)
}
