#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const setup = await connectMiraxDb()
const workerA = await connectMiraxDb()
const workerB = await connectMiraxDb()
let searchId

try {
  const created = await setup.query(
    `insert into public.searches(category,location,status,results,zone,intent)
     values('job-lease-validation','Italia','pending','[]','3',
       '{"lifecycle_stage":"validation","customer_visible":false}'::jsonb)
     returning id`,
  )
  searchId = created.rows[0].id

  const claim = (client, workerId) => client.query(
    `update public.searches
        set status='processing',worker_id=$2,heartbeat_at=now(),
            lease_expires_at=now()+interval '30 minutes',
            attempt_count=coalesce(attempt_count,0)+1
      where id=$1 and status='pending'
      returning id,worker_id,attempt_count`,
    [searchId, workerId],
  )
  const [a, b] = await Promise.all([claim(workerA, 'failure-test-a'), claim(workerB, 'failure-test-b')])
  const winners = [a, b].filter((result) => result.rowCount === 1)
  if (winners.length !== 1) throw new Error(`exactly-once claim failed winners=${winners.length}`)
  if (Number(winners[0].rows[0].attempt_count) !== 1) throw new Error('attempt_count was not incremented exactly once')

  await setup.query(
    `update public.searches set heartbeat_at=now()-interval '45 minutes',
       lease_expires_at=now()-interval '15 minutes' where id=$1`,
    [searchId],
  )
  const recovered = await setup.query(
    `update public.searches
        set status='pending',worker_id=null,heartbeat_at=null,lease_expires_at=null
      where id=$1 and status='processing' and lease_expires_at < now()
      returning id,status,worker_id,lease_expires_at`,
    [searchId],
  )
  if (recovered.rowCount !== 1 || recovered.rows[0].status !== 'pending' ||
      recovered.rows[0].worker_id !== null || recovered.rows[0].lease_expires_at !== null) {
    throw new Error('interrupted one-shot recovery failed')
  }

  const secondClaim = await claim(workerA, 'failure-test-restart')
  if (secondClaim.rowCount !== 1 || Number(secondClaim.rows[0].attempt_count) !== 2) {
    throw new Error('recovered job was not claimable exactly once after restart')
  }
  console.log('Job lease DB: concurrent delivery exactly-once; stale recovery and restart PASS')
} finally {
  if (searchId) await setup.query('delete from public.searches where id=$1', [searchId]).catch(() => undefined)
  await Promise.all([setup.end(), workerA.end(), workerB.end()])
}
