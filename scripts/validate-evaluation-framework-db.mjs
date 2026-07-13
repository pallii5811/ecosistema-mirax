#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
const migration = fs.readFileSync('db/migrations/2026_07_12_evaluation_canary_framework.sql', 'utf8')
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('begin')
  await client.query('set local statement_timeout=30000')
  console.log('Evaluation framework: applying schema in transaction...')
  await client.query(migration)
  console.log('Evaluation framework: schema applied, testing invariants...')
  const run = await client.query(
    `insert into public.evaluation_runs(dataset_version,release_id,mode,configuration)
     values('validation','validation','offline','{}') returning id`,
  )
  const metrics = await client.query('select public.evaluation_metrics($1) payload', [run.rows[0].id])
  if (Number(metrics.rows[0].payload.human_judgments) !== 0) throw new Error('empty metric denominator failed')
  await client.query('savepoint expected_visible_failure')
  let blocked = false
  try {
    await client.query(
      `insert into public.canary_runs(canary_type,exact_query,max_leads,hard_budget_eur,customer_visible)
       values('validation','validation',3,.075,true)`,
    )
  } catch (error) {
    blocked = String(error?.message || '').includes('canary_runs_customer_visible_check')
    await client.query('rollback to savepoint expected_visible_failure')
  }
  if (!blocked) throw new Error('customer-visible canary was accepted')
  await client.query('delete from public.evaluation_runs where id=$1', [run.rows[0].id])
  if (apply) {
    await client.query('commit')
    console.log('Evaluation/canary framework DB: validated and applied')
  } else {
    await client.query('rollback')
    console.log('Evaluation/canary framework DB: transaction validation passed; rolled back')
  }
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(`Evaluation framework validation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end()
}
