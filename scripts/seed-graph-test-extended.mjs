#!/usr/bin/env node
/**
 * Seed an extended test graph to exercise natural-language agentic search.
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

const TEST_CANONICAL_IDS = []

async function upsertEntity(canonicalId, type, name, opts = {}) {
  TEST_CANONICAL_IDS.push(canonicalId)
  const { data, error } = await sb
    .from('universe_entities')
    .upsert(
      {
        canonical_id: canonicalId,
        entity_type: type,
        name,
        slug: canonicalId,
        city: opts.city ?? null,
        country: opts.country ?? 'IT',
        confidence: opts.confidence ?? 1,
        metadata: opts.metadata ?? {},
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'canonical_id,entity_type' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function upsertObservation(entityId, attribute, value, opts = {}) {
  const key = `${entityId}:${attribute}:${opts.source ?? 'test_seed'}`
  const { error } = await sb.from('universe_observations').upsert(
    {
      entity_id: entityId,
      attribute,
      value,
      source: opts.source ?? 'test_seed',
      observed_at: opts.observed_at ?? new Date().toISOString(),
      confidence: opts.confidence ?? 1,
      dedup_key: key,
    },
    { onConflict: 'dedup_key' },
  )
  if (error) throw error
}

function relDedup(src, tgt, type) {
  return `${src}:${tgt}:${type}`
}

async function upsertRelationship(src, tgt, type, opts = {}) {
  const { error } = await sb.from('universe_relationships').upsert(
    {
      source_entity_id: src,
      target_entity_id: tgt,
      relationship_type: type,
      source: opts.source ?? 'test_seed',
      observed_at: opts.observed_at ?? new Date().toISOString(),
      confidence: opts.confidence ?? 0.9,
      dedup_key: relDedup(src, tgt, type),
    },
    { onConflict: 'source_entity_id,target_entity_id,relationship_type' },
  )
  if (error) throw error
}

async function upsertEvent(entityId, eventType, payload, opts = {}) {
  const key = `${entityId}:${eventType}:${opts.source ?? 'test_seed'}:${new Date().toISOString().slice(0, 10)}`
  const { error } = await sb.from('universe_events').upsert(
    {
      entity_id: entityId,
      event_type: eventType,
      payload,
      source: opts.source ?? 'test_seed',
      occurred_at: opts.occurred_at ?? new Date().toISOString(),
      dedup_key: key,
    },
    { onConflict: 'dedup_key' },
  )
  if (error) throw error
}

export async function seedExtendedGraphTest() {
  // Ristorazione cluster — Milano
  const bistrot = await upsertEntity('test-bistrot-milano', 'company', 'Bistrot Milano Srl', {
    city: 'Milano',
    metadata: { category: 'ristorazione' },
  })
  await upsertObservation(bistrot, 'category', 'ristorazione')
  await upsertObservation(bistrot, 'employees', 20)
  await upsertObservation(bistrot, 'revenue', 1_500_000)
  await upsertObservation(bistrot, 'meta_pixel', false)
  await upsertObservation(bistrot, 'google_analytics', true)
  await upsertObservation(bistrot, 'ssl', true)
  await upsertObservation(bistrot, 'rating', 4.2)

  const ristoranteCliente = await upsertEntity('test-ristorante-scala', 'company', 'Ristorante La Scala Srl', {
    city: 'Milano',
    metadata: { category: 'ristorazione' },
  })
  await upsertObservation(ristoranteCliente, 'category', 'ristorazione')
  await upsertObservation(ristoranteCliente, 'employees', 35)
  await upsertObservation(ristoranteCliente, 'revenue', 3_000_000)
  await upsertObservation(ristoranteCliente, 'meta_pixel', true)
  await upsertObservation(ristoranteCliente, 'ssl', true)

  const fornitoreAlim = await upsertEntity('test-fornitore-alimentari', 'company', 'Fornitore Alimentari Nord Srl', {
    city: 'Milano',
    metadata: { category: 'fornitura alimentare' },
  })
  await upsertObservation(fornitoreAlim, 'category', 'fornitura alimentare')
  await upsertObservation(fornitoreAlim, 'employees', 12)
  await upsertObservation(fornitoreAlim, 'ssl', true)

  const competitorRisto = await upsertEntity('test-trattoria-duomo', 'company', 'Trattoria Duomo Srl', {
    city: 'Milano',
    metadata: { category: 'ristorazione' },
  })
  await upsertObservation(competitorRisto, 'category', 'ristorazione')
  await upsertObservation(competitorRisto, 'employees', 18)
  await upsertObservation(competitorRisto, 'meta_pixel', false)

  const deliveryPartner = await upsertEntity('test-delivery-express', 'company', 'Delivery Express Srl', {
    city: 'Milano',
    metadata: { category: 'delivery' },
  })
  await upsertObservation(deliveryPartner, 'category', 'delivery')

  const vcFood = await upsertEntity('test-vc-foodtech', 'investor', 'VC FoodTech Srl', {
    city: 'Milano',
  })

  await upsertRelationship(bistrot, ristoranteCliente, 'has_customer')
  await upsertRelationship(ristoranteCliente, bistrot, 'customer_of')
  await upsertRelationship(fornitoreAlim, bistrot, 'sells_to')
  await upsertRelationship(bistrot, fornitoreAlim, 'buys_from')
  await upsertRelationship(bistrot, competitorRisto, 'competes_with')
  await upsertRelationship(competitorRisto, bistrot, 'competes_with')
  await upsertRelationship(ristoranteCliente, competitorRisto, 'competes_with')
  await upsertRelationship(competitorRisto, ristoranteCliente, 'competes_with')
  await upsertRelationship(bistrot, deliveryPartner, 'partner_of')
  await upsertRelationship(deliveryPartner, bistrot, 'partner_of')
  await upsertRelationship(bistrot, vcFood, 'received_investment_from')
  await upsertRelationship(vcFood, bistrot, 'invested_in')

  // Software cluster — Padova
  const softwareHouse = await upsertEntity('test-softwarehouse-padova', 'company', 'SoftwareHouse Padova Srl', {
    city: 'Padova',
    metadata: { category: 'software' },
  })
  await upsertObservation(softwareHouse, 'category', 'software')
  await upsertObservation(softwareHouse, 'company_stage', 'startup')
  await upsertObservation(softwareHouse, 'employees', 45)
  await upsertObservation(softwareHouse, 'revenue', 5_000_000)
  await upsertObservation(softwareHouse, 'meta_pixel', true)
  await upsertObservation(softwareHouse, 'google_analytics', true)
  await upsertObservation(softwareHouse, 'ssl', true)

  const agricolaCliente = await upsertEntity('test-agricola-veneta', 'company', 'Azienda Agricola Veneta Spa', {
    city: 'Padova',
    metadata: { category: 'agricoltura' },
  })
  await upsertObservation(agricolaCliente, 'category', 'agricoltura')
  await upsertObservation(agricolaCliente, 'employees', 30)

  const cloudProvider = await upsertEntity('test-cloud-provider', 'company', 'Cloud Provider Italia Srl', {
    city: 'Roma',
    metadata: { category: 'cloud' },
  })
  await upsertObservation(cloudProvider, 'category', 'cloud')

  const devCompetitor = await upsertEntity('test-dev-competitor', 'company', 'DevCompetitor Srl', {
    city: 'Padova',
    metadata: { category: 'software' },
  })
  await upsertObservation(devCompetitor, 'category', 'software')

  const wordpressTech = await upsertEntity('test-tech-wordpress', 'technology', 'WordPress', {})
  const reactTech = await upsertEntity('test-tech-react', 'technology', 'React', {})
  const shopifyTech = await upsertEntity('test-tech-shopify', 'technology', 'Shopify', {})
  const gtmTech = await upsertEntity('test-tech-gtm', 'technology', 'Google Tag Manager', {})

  await upsertRelationship(softwareHouse, agricolaCliente, 'has_customer')
  await upsertRelationship(agricolaCliente, softwareHouse, 'customer_of')
  await upsertRelationship(cloudProvider, softwareHouse, 'sells_to')
  await upsertRelationship(softwareHouse, cloudProvider, 'buys_from')
  await upsertRelationship(softwareHouse, devCompetitor, 'competes_with')
  await upsertRelationship(devCompetitor, softwareHouse, 'competes_with')
  await upsertRelationship(softwareHouse, reactTech, 'uses')
  await upsertRelationship(bistrot, wordpressTech, 'uses')

  const frontendJob = await upsertEntity('test-job-frontend', 'job', 'Frontend Developer / Sviluppatore Frontend', { city: 'Padova' })
  await upsertRelationship(softwareHouse, frontendJob, 'hires')
  await upsertEvent(softwareHouse, 'new_hiring', { job_title: 'Frontend Developer', role: 'Frontend' })
  await upsertEvent(softwareHouse, 'funding_received', { amount: 2_000_000, round: 'Series A' })

  // Edilizia cluster — Roma
  const impresaEdile = await upsertEntity('test-impresa-edile-roma', 'company', 'Impresa Edile Roma Spa', {
    city: 'Roma',
    metadata: { category: 'edilizia' },
  })
  await upsertObservation(impresaEdile, 'category', 'edilizia')
  await upsertObservation(impresaEdile, 'employees', 80)
  await upsertObservation(impresaEdile, 'revenue', 10_000_000)
  await upsertObservation(impresaEdile, 'meta_pixel', false)
  await upsertObservation(impresaEdile, 'ssl', true)

  const materialiEdili = await upsertEntity('test-materiali-edili', 'company', 'Materiali Edili Sud Srl', {
    city: 'Roma',
    metadata: { category: 'materiali edili' },
  })
  await upsertObservation(materialiEdili, 'category', 'materiali edili')

  const marioRossi = await upsertEntity('test-mario-rossi', 'person', 'Mario Rossi', {})

  const tender = await upsertEntity('test-tender-roma', 'tender', 'Appalto Pubblico Roma', { city: 'Roma' })

  await upsertRelationship(impresaEdile, materialiEdili, 'buys_from')
  await upsertRelationship(materialiEdili, impresaEdile, 'sells_to')
  await upsertRelationship(impresaEdile, marioRossi, 'has', { source: 'test_seed' })
  await upsertRelationship(impresaEdile, tender, 'awarded_to')
  await upsertEvent(impresaEdile, 'tender_won', { title: 'Appalto Pubblico Roma', amount: 1_200_000 })

  const muratoreJob = await upsertEntity('test-job-muratore', 'job', 'Muratore Edile / Operaio Edile', { city: 'Roma' })
  await upsertRelationship(impresaEdile, muratoreJob, 'hires')
  await upsertEvent(impresaEdile, 'new_hiring', { job_title: 'Muratore Edile', role: 'Muratore' })

  // Ecommerce cluster — Torino
  const ecommerce = await upsertEntity('test-shop-online-torino', 'company', 'Shop Online Torino Srl', {
    city: 'Torino',
    metadata: { category: 'ecommerce' },
  })
  await upsertObservation(ecommerce, 'category', 'ecommerce')
  await upsertObservation(ecommerce, 'employees', 25)
  await upsertObservation(ecommerce, 'meta_pixel', true)
  await upsertObservation(ecommerce, 'ssl', true)
  await upsertRelationship(ecommerce, shopifyTech, 'uses')
  await upsertRelationship(ecommerce, gtmTech, 'uses')

  const logistica = await upsertEntity('test-logistica-express', 'company', 'Logistica Express Srl', {
    city: 'Torino',
    metadata: { category: 'logistica' },
  })
  await upsertObservation(logistica, 'category', 'logistica')
  await upsertRelationship(logistica, ecommerce, 'sells_to')
  await upsertRelationship(ecommerce, logistica, 'buys_from')

  return {
    bistrot,
    ristoranteCliente,
    fornitoreAlim,
    competitorRisto,
    deliveryPartner,
    vcFood,
    softwareHouse,
    agricolaCliente,
    cloudProvider,
    devCompetitor,
    impresaEdile,
    materialiEdili,
    marioRossi,
    tender,
    ecommerce,
    logistica,
  }
}

export async function cleanupExtendedGraphTest() {
  if (TEST_CANONICAL_IDS.length === 0) return
  const { data } = await sb.from('universe_entities').select('id').in('canonical_id', TEST_CANONICAL_IDS)
  const ids = (data || []).map((d) => d.id)
  if (ids.length) {
    await sb.from('universe_relationships').delete().or(`source_entity_id.in.(${ids}),target_entity_id.in.(${ids})`)
    await sb.from('universe_observations').delete().in('entity_id', ids)
    await sb.from('universe_events').delete().in('entity_id', ids)
    await sb.from('universe_entities').delete().in('id', ids)
  }
}

