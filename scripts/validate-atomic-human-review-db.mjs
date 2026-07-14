#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const migration = fs.readFileSync('db/migrations/2026_07_14_atomic_human_review.sql', 'utf8')
const client = await connectMiraxDb()
try {
  await client.query('begin')
  await client.query(migration)
  const user = await client.query('select id from auth.users order by created_at asc limit 1')
  const userId = user.rows[0]?.id
  if (!userId) throw new Error('atomic human review validation requires an auth user')
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  const run = await client.query(
    `insert into public.evaluation_runs(dataset_version,release_id,mode,status,configuration)
     values('mirax-gold-v5','atomic-review-validation','offline','running',
       '{"purpose":"human_ground_truth","model_generated_labels_forbidden":true}'::jsonb) returning id`,
  )
  const ready = await client.query(
    `insert into public.evaluation_cases(
      dataset_version,cohort,vertical,case_number,seller_profile,query,candidate_snapshot,provenance,review_status
    ) values('mirax-gold-v5','v5_output',$1,1,'{}','validation query',
      '{"name":"Validation Srl","website":"https://validation.example"}',
      '{"human_ground_truth_required":true}', 'candidate_ready') returning id`,
    [`atomic-review-${suffix}`],
  )
  const call = (caseId, label = 'positive') => client.query(
    `select public.submit_human_evaluation_judgment(
      $1,$2,$3,$4,'Motivazione umana verificata di almeno venti caratteri',
      'validation.example','small',now(),'https://validation.example/evidence',
      true,true,true,true,true,'available_extracted',true
    ) payload`,
    [caseId, run.rows[0].id, userId, label],
  )
  await call(ready.rows[0].id)
  await call(ready.rows[0].id)
  const exact = await client.query(
    `select
      (select count(*)::int from public.evaluation_expected_labels where case_id=$1) expected,
      (select count(*)::int from public.evaluation_judgments where case_id=$1 and is_human) judgments,
      (select review_status from public.evaluation_cases where id=$1) status`,
    [ready.rows[0].id],
  )
  if (exact.rows[0].expected !== 1 || exact.rows[0].judgments !== 1 || exact.rows[0].status !== 'labeled') {
    throw new Error(`human review retry not atomic/idempotent: ${JSON.stringify(exact.rows[0])}`)
  }

  const empty = await client.query(
    `insert into public.evaluation_cases(
      dataset_version,cohort,vertical,case_number,seller_profile,query,candidate_snapshot,provenance,review_status
    ) values('mirax-gold-v5','v5_output',$1,1,'{}','not ready query',
      '{"name":"Not Ready Srl"}','{}','empty') returning id`,
    [`atomic-not-ready-${suffix}`],
  )
  await client.query('savepoint not_ready_failure')
  let rejected = false
  try {
    await call(empty.rows[0].id, 'negative')
  } catch (error) {
    rejected = String(error?.message || '').includes('EVALUATION_CASE_NOT_READY')
    await client.query('rollback to savepoint not_ready_failure')
  }
  if (!rejected) throw new Error('not-ready evaluation packet was accepted')
  const noPartial = await client.query(
    `select
      (select count(*)::int from public.evaluation_expected_labels where case_id=$1) expected,
      (select count(*)::int from public.evaluation_judgments where case_id=$1) judgments`,
    [empty.rows[0].id],
  )
  if (noPartial.rows[0].expected !== 0 || noPartial.rows[0].judgments !== 0) {
    throw new Error('failed human review left partial rows')
  }
  await client.query('rollback')
  console.log('Atomic human review DB: idempotent submit + no partial failure PASS; rolled back')
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
