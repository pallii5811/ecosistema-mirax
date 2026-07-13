#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const [canaryId, runId, reason = 'manual_quality_quarantine'] = process.argv.slice(2)
if (!/^[0-9a-f-]{36}$/i.test(canaryId || '') || !/^[0-9a-f-]{36}$/i.test(runId || '')) {
  console.error('usage: node scripts/quarantine-canary-run.mjs <canary-id> <evaluation-run-id> [reason]')
  process.exit(1)
}
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('begin')
  const canary = await client.query(
    `update public.canary_runs set status='quarantined', stop_reason=$2::text, completed_at=coalesce(completed_at,now())
     where id=$1 returning id,search_id`,
    [canaryId, reason.slice(0, 500)],
  )
  const run = await client.query(
    `update public.evaluation_runs set status='failed', metrics=metrics || jsonb_build_object('quarantine_reason',$2::text),
       completed_at=coalesce(completed_at,now()) where id=$1 returning id`,
    [runId, reason.slice(0, 500)],
  )
  if (canary.rowCount !== 1 || run.rowCount !== 1) throw new Error('canary or evaluation run not found')
  const searchId = canary.rows[0]?.search_id
  if (!searchId) throw new Error('canary search_id missing')
  const search = await client.query(
    `update public.searches
       set status='cancelled', results='[]'::jsonb,
           progress=coalesce(progress,'{}'::jsonb) || jsonb_build_object('stop_reason',$2::text,'quarantined_at',now())
     where id=$1 and status in ('planning','pending','pending_user','processing','running','cancelled')
     returning id`,
    [searchId, reason.slice(0, 500)],
  )
  if (search.rowCount !== 1) throw new Error('canary search not found or already terminal outside quarantine contract')
  await client.query('commit')
  console.log(`quarantined canary=${canaryId} run=${runId} search=${searchId} reason=${reason}`)
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
