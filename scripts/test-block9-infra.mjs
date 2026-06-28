/**
 * Blocco 9 — verifica presenza script deploy/monitor
 */
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const required = [
  'backend_mirror/scripts/deploy-staging.sh',
  'backend_mirror/scripts/deploy-prod.sh',
  'backend_mirror/scripts/monitor-worker.sh',
  'backend_mirror/DEPLOY_CHECKLIST.md',
  'db/migrations/2026_06_28_ai_audit_trail.sql',
  'src/lib/ai-act-audit.ts',
  'src/app/api/ops/worker-health/route.ts',
  'src/app/api/compliance/audit-trail/route.ts',
]

for (const rel of required) {
  const p = path.join(ROOT, rel)
  assert.ok(fs.existsSync(p), `missing ${rel}`)
}

const deploy = fs.readFileSync(path.join(ROOT, 'backend_mirror/scripts/deploy-prod.sh'), 'utf8')
assert.ok(deploy.includes('CONFIRM_PROD=1'))
assert.ok(deploy.includes('BACKUP_DIR'))

console.log('[test-block9-infra] OK')
