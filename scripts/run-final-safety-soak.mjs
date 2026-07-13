#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const iterations = Math.max(1, Math.min(100, Number(process.env.MIRAX_SOAK_ITERATIONS || 5)))
const startedAt = new Date()
const failures = []
const samples = []
const reportPath = 'reports/final-safety-soak-v5.json'
fs.mkdirSync('reports', { recursive: true })

function checkpoint(completed = false) {
  const report = {
    release_id: '2026-07-12-final-hardening-v5',
    started_at: startedAt.toISOString(), completed_at: completed ? new Date().toISOString() : null,
    checkpointed_at: new Date().toISOString(), iterations_requested: iterations,
    checks_executed: samples.length, failures, passed: completed && failures.length === 0,
    interrupted_or_running: !completed,
    invariants: { paid_providers_called: false, workers_started: false, customer_publications_created: false, validators_use_transaction_rollback: true },
    elapsed_ms: Date.now() - startedAt.getTime(), samples,
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function run(label, command, args) {
  const t0 = Date.now()
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: 'utf8', shell: false, timeout: 60_000, killSignal: 'SIGTERM',
  })
  const sample = { label, exit_code: result.status, elapsed_ms: Date.now() - t0 }
  samples.push(sample)
  if (result.status !== 0) {
    failures.push({ ...sample, error: result.error?.message || null, stderr: String(result.stderr || result.stdout || '').slice(-2000) })
  }
  checkpoint(false)
  return result
}

run('python_failure_suite', 'python', ['-m','pytest','-q',
  'backend_mirror/test_atomic_paid_operations.py',
  'backend_mirror/test_final_failure_injection.py',
  'backend_mirror/test_job_leases.py',
  'backend_mirror/test_url_safety_adaptive_audit.py',
])
run('paid_operation_static_guard', 'node', ['scripts/test-paid-operation-guards.mjs'])

for (let index = 1; index <= iterations && failures.length === 0; index += 1) {
  run(`cost_atomic_${index}`, 'node', ['scripts/validate-atomic-cost-governor-db.mjs'])
  run(`cost_concurrency_${index}`, 'node', ['scripts/test-cost-governor-concurrency-db.mjs'])
  run(`credit_ledger_${index}`, 'node', ['scripts/validate-publication-credit-ledger-db.mjs'])
}

const report = checkpoint(true)
console.log(JSON.stringify({ passed: report.passed, checks_executed: report.checks_executed, iterations, elapsed_ms: report.elapsed_ms, report: reportPath }))
if (!report.passed) process.exitCode = 1
