#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
const migration = fs.readFileSync('db/migrations/2026_07_12_publication_credit_ledger.sql', 'utf8')
const atomicMigration = fs.readFileSync('db/migrations/2026_07_14_atomic_publication_credit.sql', 'utf8')
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()

try {
  await client.query('begin')
  await client.query(migration)
  await client.query(atomicMigration)
  const user = await client.query('select id from auth.users order by created_at asc limit 1')
  const userId = user.rows[0]?.id
  if (!userId) throw new Error('missing validation user')
  const initial = await client.query('select credits from public.profiles where id=$1 for update', [userId])
  if (!initial.rows[0] || Number(initial.rows[0].credits) < 1) throw new Error('validation user has no credits')
  const initialCredits = Number(initial.rows[0].credits)
  const search = await client.query(
    `insert into public.searches(user_id,category,location,status,results,zone,intent)
     values($1,'credit-ledger-validation','Italia','completed','[]','5','{"requested_leads":5}') returning id`,
    [userId],
  )
  const searchId = search.rows[0].id

  const invalidCandidate = await client.query(
    `insert into public.search_candidates(
      search_id,user_id,canonical_domain,entity_name,stage,payload
    ) values($1,$2,'invalid-credit.example','Invalid Credit Srl','audit_pending','{}') returning id`,
    [searchId, userId],
  )
  await client.query('savepoint publication_gate_failure')
  let gateFailed = false
  try {
    await client.query('select public.publish_search_candidate($1)', [invalidCandidate.rows[0].id])
  } catch (error) {
    gateFailed = String(error?.message || '').includes('PUBLICATION_GATE_FAILED')
    await client.query('rollback to savepoint publication_gate_failure')
  }
  if (!gateFailed) throw new Error('invalid candidate crossed atomic publication gate')
  const invalidSideEffects = await client.query(
    `select
       (select count(*)::int from public.search_publications where candidate_id=$1) publications,
       (select count(*)::int from public.search_credit_charges where candidate_id=$1) charges`,
    [invalidCandidate.rows[0].id],
  )
  if (invalidSideEffects.rows[0].publications !== 0 || invalidSideEffects.rows[0].charges !== 0) {
    throw new Error('failed publication left partial side effects')
  }
  const candidate = await client.query(
    `insert into public.search_candidates(
      search_id,user_id,canonical_domain,entity_name,legal_name,stage,official_domain_verified,
      entity_resolution_method,entity_resolution_confidence,positive_identity_signals,identity_source_url,
      identity_resolved_at,target_fit_verified,signal_verified,evidence_policy_passed,audit_completed,payload
      ,operating_company_probability,official_domain_confidence,company_size_class,is_operating_buyer
    ) values($1,$2,'credit.example','Credit Srl','Credit Srl','published',true,'positive_page_identity',
      .95,'["company_tokens_in_host","legal_name_in_page"]','https://credit.example/',now(),true,true,true,true,'{}',
      .90,.95,'small',true) returning id`,
    [searchId, userId],
  )
  await client.query(
    `insert into public.search_evidence(
      search_id,candidate_id,signal_type,fact_type,claim_type,claim_value,source_url,
      source_class,source_publisher,evidence_excerpt,observed_at,retrieval_method,
      verification_status,contradiction_status,confidence,is_primary_source,content_hash
    ) values($1,$2,'hiring_operational','observed_fact','buying_signal','Ricerca operatori',
      'https://credit.example/careers','company_careers','credit.example','Ricerca operatori',
      now(),'http_fetch','primary_source_verified','none',.95,true,'atomic-credit-validation')`,
    [searchId, candidate.rows[0].id],
  )

  await client.query('savepoint insufficient_credit_failure')
  let insufficientFailed = false
  try {
    await client.query('update public.profiles set credits=0 where id=$1', [userId])
    await client.query('select public.publish_search_candidate($1)', [candidate.rows[0].id])
  } catch (error) {
    insufficientFailed = String(error?.message || '').includes('INSUFFICIENT_CREDITS')
    await client.query('rollback to savepoint insufficient_credit_failure')
  }
  if (!insufficientFailed) throw new Error('publication succeeded without customer credit')
  const insufficientSideEffects = await client.query(
    `select
       (select count(*)::int from public.search_publications where candidate_id=$1) publications,
       (select count(*)::int from public.search_credit_charges where candidate_id=$1) charges`,
    [candidate.rows[0].id],
  )
  if (insufficientSideEffects.rows[0].publications !== 0 || insufficientSideEffects.rows[0].charges !== 0) {
    throw new Error('insufficient-credit failure left partial side effects')
  }

  const first = await client.query('select public.publish_search_candidate($1) id', [candidate.rows[0].id])
  const second = await client.query('select public.publish_search_candidate($1) id', [candidate.rows[0].id])
  const publicationId = first.rows[0]?.id
  if (!publicationId || second.rows[0]?.id !== publicationId) throw new Error('publication retry changed identity')
  const charged = await client.query(
    'select count(*)::int n from public.search_credit_charges where search_id=$1 and status=\'charged\'',
    [searchId],
  )
  const afterCharge = await client.query('select credits from public.profiles where id=$1', [userId])
  if (charged.rows[0].n !== 1 || Number(afterCharge.rows[0].credits) !== initialCredits - 1) {
    throw new Error('atomic publication charge was not exactly once')
  }

  // RLS: the owner sees the durable publication; another authenticated subject does not.
  await client.query('set local role authenticated')
  await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  const ownerRows = await client.query('select count(*)::int n from public.search_publications where id=$1', [publicationId])
  await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, ['00000000-0000-0000-0000-000000000001'])
  const strangerRows = await client.query('select count(*)::int n from public.search_publications where id=$1', [publicationId])
  await client.query('reset role')
  if (ownerRows.rows[0].n !== 1 || strangerRows.rows[0].n !== 0) throw new Error('publication ownership RLS failed')

  const refund = await client.query('select public.refund_search_publication_credit($1,$2) ok', [publicationId, 'validation'])
  if (refund.rows[0].ok !== true) throw new Error('refund failed')
  const duplicateRefund = await client.query('select public.refund_search_publication_credit($1,$2) ok', [publicationId, 'duplicate'])
  if (duplicateRefund.rows[0].ok !== false) throw new Error('duplicate refund was not idempotent')
  const restored = await client.query('select credits from public.profiles where id=$1', [userId])
  if (Number(restored.rows[0].credits) !== initialCredits) throw new Error('credits were not restored exactly')

  await client.query('delete from public.search_credit_charges where search_id=$1', [searchId])
  await client.query('delete from public.searches where id=$1', [searchId])
  if (apply) {
    await client.query('commit')
    console.log('Publication credit ledger DB: validated and applied')
  } else {
    await client.query('rollback')
    console.log('Publication credit ledger DB: transaction validation passed; rolled back')
  }
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(`Publication credit ledger validation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end()
}
