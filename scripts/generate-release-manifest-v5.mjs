#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceFiles = [
  'contracts/commercial-search-plan.schema.json','contracts/source-registry.v1.json','contracts/signal-ontology.v1.json',
  'src/lib/intent-compiler/compile-commercial-search-plan.ts','src/lib/research/persistent-cost-governor.ts',
  'backend_mirror/worker_supabase.py','backend_mirror/cost_governor.py','backend_mirror/commercial_lifecycle.py',
  'backend_mirror/url_safety.py','backend_mirror/adaptive_audit.py','backend_mirror/agents/agentic_gap_fill.py',
  'backend_mirror/agents/data_extractor.py','backend_mirror/agents/web_researcher.py','backend_mirror/agents/search_serp.py',
]
const migrations = fs.readdirSync('db/migrations').filter((file) => file.endsWith('.sql')).sort()
  .map((file) => ({ file: `db/migrations/${file}`, sha256: sha256(path.join('db/migrations', file)) }))
let gitCommit = null
let changedFiles = null
try {
  gitCommit = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim()
  changedFiles = execFileSync('git', ['status','--porcelain'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).length
} catch {}
const response = await fetch('https://ecosistema-mirax-two.vercel.app/api/ops/release', {
  headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
})
if (!response.ok) throw new Error(`runtime marker HTTP ${response.status}`)
const runtime = await response.json()
if (runtime.release_id !== '2026-07-12-final-hardening-v5' || runtime.production_search_disabled !== true) {
  throw new Error(`runtime drift: ${JSON.stringify(runtime)}`)
}
const manifest = {
  manifest_version: '1.0.0', generated_at: new Date().toISOString(),
  frontend: {
    release_id: runtime.release_id,
    deployment_url: 'https://ecosistema-mirax-7hbcjzbic-simodepertis-projects.vercel.app',
    production_alias: 'https://ecosistema-mirax-two.vercel.app',
    immutable_deployment_inspect_id: 'DbY1GAGBjhibc9cQ5YPsxo151qzB',
    production_search_disabled: runtime.production_search_disabled,
  },
  backend: {
    host: '116.203.137.39', frozen_release_id: '20260712_201500_v4',
    live_path: '/home/worker/app/backend', staging_path: '/home/worker/app/backend-staging',
    workers_expected: 'inactive+disabled', paid_extraction_expected: false,
  },
  database: { migration_count: migrations.length, migrations },
  source_hashes: sourceFiles.map((file) => ({ file, sha256: sha256(file) })),
  evidence_reports: [
    'reports/final-safety-soak-v5.json','reports/rollback-rehearsal-v5.json',
  ].map((file) => ({ file, sha256: sha256(file) })),
  git: { commit: gitCommit, dirty_worktree: Boolean(changedFiles), changed_file_count: changedFiles },
  release_scope: 'controlled-safe-state; customer search disabled; human review enabled',
  acceptance_complete: false,
  incomplete_gates: ['human_judgments_200','intent_canary_v5','multi_vertical_canaries','live_precision_coverage_cost'],
}
fs.mkdirSync('reports', { recursive: true })
fs.writeFileSync('reports/release-manifest-v5.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ release: runtime.release_id, migration_count: migrations.length, source_hashes: sourceFiles.length, dirty_worktree: manifest.git.dirty_worktree, acceptance_complete: false }))
