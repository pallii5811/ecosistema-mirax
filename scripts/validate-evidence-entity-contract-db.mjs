#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
const migration = fs.readFileSync('db/migrations/2026_07_12_evidence_entity_contract.sql', 'utf8')
if (!loadMiraxDbPassword()) process.exit(1)

const client = await connectMiraxDb()
try {
  await client.query('begin')
  await client.query(migration)
  const user = await client.query('select id from auth.users order by created_at asc limit 1')
  if (!user.rows[0]?.id) throw new Error('validation requires an existing auth user')
  const userId = user.rows[0].id
  const search = await client.query(
    `insert into public.searches(user_id, category, location, status, results, zone, intent)
     values ($1, 'evidence-contract-validation', 'Italia', 'processing', '[]'::jsonb, '5',
       '{"requested_leads":5}'::jsonb) returning id`,
    [userId],
  )
  const searchId = search.rows[0].id

  await client.query('savepoint expected_identity_failure')
  let rejected = false
  try {
    await client.query(
      `insert into public.search_candidates(
        search_id,user_id,canonical_domain,entity_name,stage,official_domain_verified,
        target_fit_verified,signal_verified,evidence_policy_passed,audit_completed,payload
      ) values ($1,$2,'invalid.example','Invalid Srl','qualified',true,true,true,true,true,'{}')`,
      [searchId, userId],
    )
  } catch (error) {
    rejected = String(error?.message || '').includes('search_candidates_positive_identity_gate')
    await client.query('rollback to savepoint expected_identity_failure')
  }
  if (!rejected) throw new Error('qualified candidate without positive identity was accepted')

  const candidate = await client.query(
    `insert into public.search_candidates(
      search_id,user_id,canonical_domain,entity_name,legal_name,stage,official_domain_verified,
      entity_resolution_method,entity_resolution_confidence,positive_identity_signals,
      identity_source_url,identity_resolved_at,target_fit_verified,signal_verified,
      evidence_policy_passed,audit_completed,operating_company_probability,official_domain_confidence,
      company_size_class,is_operating_buyer,payload
    ) values ($1,$2,'valid.example','Valid Srl','Valid Srl','qualified',true,
      'positive_page_identity',0.95,'["company_tokens_in_host","legal_name_in_page"]'::jsonb,
      'https://valid.example/',now(),true,true,true,true,.90,.95,'small',true,'{"azienda":"Valid Srl"}'::jsonb)
    returning id`,
    [searchId, userId],
  )
  const candidateId = candidate.rows[0].id
  await client.query(
    `insert into public.search_evidence(
      search_id,candidate_id,signal_type,fact_type,claim_type,claim_value,source_url,
      source_class,source_publisher,evidence_excerpt,observed_at,retrieval_method,
      verification_status,contradiction_status,confidence,is_primary_source,content_hash
    ) values ($1,$2,'hiring_operational','observed_fact','buying_signal','Ricerca autisti',
      'https://valid.example/careers','company_careers','valid.example','Ricerca autisti',
      now(),'http_fetch','primary_source_verified','none',0.95,true,'contract-validation-hash')`,
    [searchId, candidateId],
  )
  const publication = await client.query('select public.publish_search_candidate($1) as id', [candidateId])
  if (!publication.rows[0]?.id) throw new Error('valid candidate was not published')

  await client.query('delete from public.searches where id = $1', [searchId])
  if (apply) {
    await client.query('commit')
    console.log('Evidence/entity DB contract: validated and applied')
  } else {
    await client.query('rollback')
    console.log('Evidence/entity DB contract: transaction validation passed; rolled back')
  }
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(`Evidence/entity DB validation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end()
}
