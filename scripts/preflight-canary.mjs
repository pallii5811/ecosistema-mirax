#!/usr/bin/env node
/**
 * MIRAX canary preflight — zero paid API calls.
 *
 * Questo script NON riattiva worker e NON crea search job.
 * Serve a bloccare la canary se mancano guardrail qualità/costo/sicurezza.
 *
 * Uso:
 *   node scripts/preflight-canary.mjs
 *   node scripts/preflight-canary.mjs --skip-ssh
 *   node scripts/preflight-canary.mjs --skip-vercel-env
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = new Set(process.argv.slice(2))
const skipSsh = args.has('--skip-ssh')
const skipVercelEnv = args.has('--skip-vercel-env')
const host = process.env.MIRAX_CANARY_HOST || '116.203.137.39'
const sshUser = process.env.MIRAX_CANARY_SSH_USER || 'root'
const appUrl = process.env.MIRAX_CANARY_APP_URL || 'https://ecosistema-mirax-two.vercel.app'
const vercelScope = process.env.MIRAX_VERCEL_SCOPE || 'simodepertis-projects'
const expectedRelease = process.env.MIRAX_EXPECTED_RELEASE || '2026-07-13-complete-signal-lane-coverage-v5-11'

const GLOBAL_BRAND_PATTERNS = [
  /\buniqlo\b/i,
  /\bprimark\b/i,
  /\burban\s+outfitters\b/i,
  /\bnike\b/i,
  /\bferrari\s+(?:flagship|store|milano|roma)\b/i,
  /\bikea\b/i,
  /\bzara\b/i,
]

function loadLocalEnvFile(file) {
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, name, rawValue] = match
    if (process.env[name]) continue
    process.env[name] = rawValue.replace(/^["']|["']$/g, '')
  }
}

loadLocalEnvFile('.env.local')
loadLocalEnvFile('.env')

const isWin = process.platform === 'win32'
const localBin = (name) => {
  const exe = isWin ? `${name}.cmd` : name
  const candidate = path.resolve('node_modules', '.bin', exe)
  return fs.existsSync(candidate) ? (isWin ? '"' + candidate + '"' : candidate) : exe
}

function run(label, command, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${label}`)
    const child = spawn(command, cmdArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...(opts.env || {}) },
      shell: opts.shell ?? isWin,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed with exit code ${code}`))
    })
  })
}

async function checkUrl() {
  console.log(`\n▶ App URL health: ${appUrl}`)
  if (isWin) {
    await run('App URL health via curl', 'curl.exe', ['-k', '-f', '-sS', '-I', appUrl])
    return
  }
  const res = await fetch(appUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' },
  })
  if (!res.ok) throw new Error(`App URL not healthy: ${res.status}`)
  console.log(`OK app reachable (${res.status})`)
}

async function checkReleaseMarker() {
  console.log(`\n▶ Runtime release marker: ${expectedRelease}`)
  const response = await fetch(`${appUrl}/api/ops/release`, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' },
  })
  if (!response.ok) throw new Error(`Release marker unavailable: ${response.status}`)
  const payload = await response.json()
  if (payload.release_id !== expectedRelease) {
    throw new Error(`Runtime release mismatch: ${payload.release_id || 'missing'} != ${expectedRelease}`)
  }
  if (payload.production_search_disabled !== true) {
    throw new Error('Runtime release marker reports production search enabled')
  }
  if (Number(payload.signal_count || 0) < 35 || Number(payload.source_class_count || 0) < 10) {
    throw new Error('Runtime release marker reports incomplete ontology/registry')
  }
  console.log(`OK release=${payload.release_id} signals=${payload.signal_count} sources=${payload.source_class_count}`)
}

async function checkVercelSearchBrake() {
  const runDir = isWin ? 'C:\\tmp' : path.resolve('.codex-runlogs')
  fs.mkdirSync(runDir, { recursive: true })
  const envFile = path.join(runDir, `vercel-production-env-check-${process.pid}.env`)

  try {
    await run('Vercel production brake: MIRAX_SEARCH_DISABLED=1', 'npx', [
      'vercel',
      'env',
      'pull',
      envFile,
      '--environment=production',
      '--scope',
      vercelScope,
    ])

    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    const raw = lines.find((line) => line.startsWith('MIRAX_SEARCH_DISABLED='))
    const value = raw
      ?.slice('MIRAX_SEARCH_DISABLED='.length)
      ?.replace(/^["']|["']$/g, '')
      .replace(/\\r/g, '')
      .replace(/\\n/g, '')
      .trim()
      .toLowerCase()

    if (!['1', 'true', 'yes', 'on'].includes(value || '')) {
      throw new Error('MIRAX_SEARCH_DISABLED is not enabled in Vercel production')
    }

    const forbiddenOpenAiEnv = [
      'OPENAI_API_KEY',
      'OPENAI_EXTRACT_ENABLED',
      'OPENAI_WEB_SEARCH_ENABLED',
      'UQE_OPENAI_ENABLED',
    ]
    const presentOpenAi = lines
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((name) => name && forbiddenOpenAiEnv.includes(name))
    if (presentOpenAi.length > 0) {
      throw new Error(`OpenAI env present in Vercel production: ${presentOpenAi.join(', ')}`)
    }
  } finally {
    try {
      fs.rmSync(envFile, { force: true })
    } catch {}
  }
}

function parseJsonResults(raw) {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object')
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : []
    } catch {
      return []
    }
  }
  return []
}

function containsGlobalBrand(lead) {
  const text = [
    lead?.azienda,
    lead?.nome,
    lead?.business_name,
    lead?.name,
    lead?.sito,
    lead?.website,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
  return GLOBAL_BRAND_PATTERNS.some((pattern) => pattern.test(text))
}

async function checkProductionDataHygiene() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.log('\n▶ Production data hygiene: skipped (Supabase env missing)')
    return
  }
  console.log('\n▶ Production data hygiene: no global brands in recent search cache')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('searches')
    .select('id, category, location, results, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`searches hygiene scan failed: ${error.message}`)
  const offenders = []
  for (const row of data || []) {
    const bad = parseJsonResults(row.results).filter(containsGlobalBrand)
    if (bad.length > 0) {
      offenders.push(`${row.id} ${row.category || ''}@${row.location || ''} bad=${bad.length}`)
    }
  }
  if (offenders.length > 0) {
    throw new Error(`global brand leads still present in search cache: ${offenders.slice(0, 5).join('; ')}`)
  }
}

async function checkGoldDatasetSafety() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Gold dataset check requires service role env')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase.from('evaluation_cases')
    .select('id,dataset_version,cohort,candidate_snapshot,provenance,review_status')
    .in('dataset_version', ['mirax-gold-v1', 'mirax-gold-v5'])
  if (error) throw new Error(`gold dataset scan failed: ${error.message}`)
  const rows = data || []
  const legacy = rows.filter((row) => row.dataset_version === 'mirax-gold-v1')
  const v5 = rows.filter((row) => row.dataset_version === 'mirax-gold-v5')
  const v5Output = v5.filter((row) => row.cohort === 'v5_output')
  const adversarial = v5.filter((row) => row.cohort === 'adversarial')
  const domains = new Set(legacy.map((row) => String(row.candidate_snapshot?.domain || '')).filter(Boolean))
  const safe = legacy.filter((row) => row.provenance?.selection_is_not_ground_truth === true && row.provenance?.human_ground_truth_required === true)
  if (legacy.length !== 200 || domains.size !== 200 || safe.length !== 200 ||
      legacy.some((row) => row.cohort !== 'legacy_baseline')) {
    throw new Error(`legacy baseline unsafe rows=${legacy.length} domains=${domains.size} no_leakage=${safe.length}`)
  }
  if (v5.some((row) => !['v5_output', 'adversarial'].includes(String(row.cohort)))) {
    throw new Error('v5 evaluation contains an invalid cohort')
  }
  const { data: judgments, error: judgmentError } = await supabase.from('evaluation_judgments')
    .select('case_id').in('case_id', rows.map((row) => String(row.id))).eq('is_human', true)
  if (judgmentError) throw new Error(`human judgment count failed: ${judgmentError.message}`)
  const reviewed = new Set((judgments || []).map((row) => String(row.case_id)))
  const legacyReviewed = legacy.filter((row) => reviewed.has(String(row.id))).length
  const v5Reviewed = v5.filter((row) => reviewed.has(String(row.id))).length
  console.log(`\n▶ Evaluation cohorts: legacy=${legacyReviewed}/25; v5_output_cases=${v5Output.length}/160; adversarial_cases=${adversarial.length}/15; v5_judgments=${v5Reviewed}; final_target=200`)
}

async function checkServerBrake() {
  const services = [
    'mirax-worker.service',
    'mirax-worker-user.service',
    'mirax-worker-staging.service',
    'mirax-worker-staging-2.service',
    'mirax-worker-staging-3.service',
    'mirax-worker-staging-4.service',
  ]
  const remote = String.raw`
set -e
services="$MIRAX_SERVICES"
bad=0
for svc in $services; do
  enabled="$(systemctl is-enabled "$svc" 2>/dev/null || true)"
  active="$(systemctl is-active "$svc" 2>/dev/null || true)"
  echo "$svc enabled=$enabled active=$active"
  if [ "$enabled" != "disabled" ]; then bad=1; fi
  if [ "$active" != "inactive" ]; then bad=1; fi
done
for envfile in /home/worker/app/backend/.env /home/worker/app/backend-staging/.env; do
  echo "--- $envfile"
  test -f "$envfile"
  grep -E '^(MIRAX_WORKER_DISABLED|ANTHROPIC_EXTRACT_ENABLED|MIRAX_LLM_MAX_REQUESTS_PER_JOB|MIRAX_LLM_MAX_COST_USD_PER_JOB)=' "$envfile"
  if grep -Eq '^(OPENAI_API_KEY|OPENAI_EXTRACT_ENABLED|OPENAI_WEB_SEARCH_ENABLED|UQE_OPENAI_ENABLED)=' "$envfile"; then
    echo "OpenAI env present in $envfile" >&2
    bad=1
  fi
  grep -q '^MIRAX_WORKER_DISABLED=1$' "$envfile" || bad=1
  grep -q '^ANTHROPIC_EXTRACT_ENABLED=0$' "$envfile" || bad=1
  grep -q '^MIRAX_LLM_MAX_COST_USD_PER_JOB=0.03$' "$envfile" || bad=1
done
for base in /home/worker/app/backend /home/worker/app/backend-staging; do
  test -f "$base/contracts/commercial_search_plan.py" || bad=1
  test -f "$base/contracts/source_registry.py" || bad=1
  test -f "$base/contracts/signal_ontology.py" || bad=1
  test -f "$base/commercial_lifecycle.py" || bad=1
  test -f "$base/cost_governor.py" || bad=1
  /home/worker/app/venv/bin/python -m py_compile "$base/worker_supabase.py" "$base/commercial_lifecycle.py" "$base/cost_governor.py" "$base/contracts/commercial_search_plan.py" "$base/contracts/source_registry.py" "$base/contracts/signal_ontology.py" || bad=1
done
test -f /home/worker/app/contracts/source-registry.v1.json || bad=1
test -f /home/worker/app/contracts/signal-ontology.v1.json || bad=1
exit "$bad"
`
  const encoded = Buffer.from(remote, 'utf8').toString('base64')
  await run('Server brake check: workers disabled + paid extraction off', 'ssh', [
    '-o',
    'StrictHostKeyChecking=no',
    `${sshUser}@${host}`,
    `MIRAX_SERVICES='${services.join(' ')}' bash -lc 'export MIRAX_SERVICES; echo ${encoded} | base64 -d | bash'`,
  ], { shell: false })
}

async function main() {
  await run('TypeScript compile', localBin('tsc'), ['--noEmit', '--pretty', 'false'])
  await run('Release marker contract', localBin('tsx'), ['scripts/test-release-marker.ts'])
  await run('Canonical commercial plan + source registry', localBin('tsx'), [
    'scripts/test-commercial-search-plan-contract.ts',
  ])
  await run('Intent compiler deterministic normalization', localBin('tsx'), [
    'scripts/test-intent-compiler-normalization.ts',
  ])
  await run('Paid-operation static guards', 'node', ['scripts/test-paid-operation-guards.mjs'])
  await run('Commercial lifecycle schema', 'node', ['scripts/test-commercial-lifecycle-schema.mjs'])
  await run('Human review security', localBin('tsx'), ['scripts/test-evaluation-review-security.ts'])
  await run('Gold evaluation metric gates', 'node', ['scripts/test-gold-evaluation-metrics.mjs'])
  await run('Central research cost governor', localBin('tsx'), ['scripts/test-research-cost-governor.ts'])
  await run('15-vertical commercial query matrix', localBin('tsx'), ['scripts/test-commercial-query-matrix.ts'])
  await run('10-vertical high-value compiler matrix', localBin('tsx'), ['scripts/test-high-value-compiler-matrix.ts'])
  await run('10-vertical deterministic signal floor', localBin('tsx'), ['scripts/test-shadow-manifest-signal-floor.ts'])
  await run('Search UI mode guards', localBin('tsx'), ['scripts/test-search-ui-mode.ts'])
  await run('Signal lead visibility guards', localBin('tsx'), ['scripts/test-signal-lead-visibility.ts'])
  await run('Enterprise lead rejection guards', localBin('tsx'), ['scripts/test-enterprise-lead-guard.ts'])
  await run('Routing guards', localBin('tsx'), ['scripts/test-routing-guards.ts'])
  await run('50 real-user query parser suite', 'node', ['scripts/test-50-real-user-queries.mjs'])
  const pytestTmp = path.resolve('tmp', 'mirax-pytest-' + process.pid)
  fs.mkdirSync(pytestTmp, { recursive: true })
  await run('Backend quality/cost guards', 'python', [
    '-m',
    'pytest',
    'backend_mirror/test_cost_quality_guards.py',
    '-q',
    '-p',
    'no:cacheprovider',
    '--basetemp',
    pytestTmp,
  ], { shell: false, env: { TMP: pytestTmp, TEMP: pytestTmp, TMPDIR: pytestTmp } })
  await run('Backend canonical contract boundary', 'python', [
    '-m',
    'pytest',
    'backend_mirror/test_commercial_search_plan_contract.py',
    '-q',
    '-p',
    'no:cacheprovider',
    '--basetemp',
    path.resolve('tmp', 'mirax-contract-pytest-' + process.pid),
  ], { shell: false })
  await run('Backend canonical lifecycle + central governor', 'python', [
    '-m',
    'pytest',
    'backend_mirror/test_cost_governor.py',
    'backend_mirror/test_commercial_lifecycle.py',
    '-q',
    '-p',
    'no:cacheprovider',
    '--basetemp',
    path.resolve('tmp', 'mirax-lifecycle-pytest-' + process.pid),
  ], { shell: false })
  await checkUrl()
  await checkReleaseMarker()
  if (!skipVercelEnv) await checkVercelSearchBrake()
  await checkProductionDataHygiene()
  await checkGoldDatasetSafety()
  if (!skipSsh) await checkServerBrake()
  console.log('\n✅ CANARY PREFLIGHT OK — safe state verified. Worker riattivazione richiede ancora OK umano esplicito.')
}

main().catch((err) => {
  console.error(`\n❌ CANARY PREFLIGHT FAILED: ${err?.message || err}`)
  process.exit(1)
})
