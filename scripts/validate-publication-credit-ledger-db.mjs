#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
const migration = fs.readFileSync('db/migrations/2026_07_12_publication_credit_ledger.sql', 'utf8')
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()

try {
  await client.query('begin')
  await client.query(migration)
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
  const publication = await client.query(
    `insert into public.search_publications(search_id,candidate_id,user_id,published_payload,evidence_snapshot)
     values($1,$2,$3,'{}','[]') returning id`,
    [searchId, candidate.rows[0].id, userId],
  )
  const publicationId = publication.rows[0].id
  await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  const first = await client.query('select public.charge_search_publications($1,10) payload', [searchId])
  const second = await client.query('select public.charge_search_publications($1,10) payload', [searchId])
  if (Number(first.rows[0].payload.charged) !== 1 || Number(second.rows[0].payload.charged) !== 0) {
    throw new Error('publication charge is not idempotent')
  }
  const refund = await client.query('select public.refund_search_publication_credit($1,$2) ok', [publicationId, 'validation'])
  if (refund.rows[0].ok !== true) throw new Error('refund failed')
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
