#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const manifest = JSON.parse(fs.readFileSync('evaluation/gold-v1/manifest.json', 'utf8'))
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('begin')
  const slots = []
  for (const vertical of manifest.verticals) {
    for (let caseNumber = 1; caseNumber <= manifest.cases_per_vertical; caseNumber += 1) {
      slots.push({
        vertical: vertical.id,
        case_number: caseNumber,
        seller_profile: { seller_category: vertical.seller },
        query: `[PENDING CONTROLLED RESEARCH] ${vertical.seller} case ${caseNumber}`,
        provenance: { status: 'not_researched', human_ground_truth_required: true },
      })
    }
  }
  await client.query(
    `insert into public.evaluation_cases(
      dataset_version,vertical,case_number,seller_profile,query,provenance,review_status
    )
    select $1, x.vertical, x.case_number, x.seller_profile, x.query, x.provenance, 'empty'
    from jsonb_to_recordset($2::jsonb) as x(
      vertical text, case_number integer, seller_profile jsonb, query text, provenance jsonb
    )
    on conflict(dataset_version,vertical,case_number) do nothing`,
    [manifest.dataset_version, JSON.stringify(slots)],
  )
  const count = await client.query(
    'select count(*)::int total from public.evaluation_cases where dataset_version=$1',
    [manifest.dataset_version],
  )
  if (Number(count.rows[0].total) !== 200) throw new Error(`expected 200 slots, found ${count.rows[0].total}`)
  await client.query('commit')
  console.log('Gold evaluation slots: 200/200 created; human labels 0/200')
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
