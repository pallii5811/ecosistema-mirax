import assert from 'node:assert/strict'
import fs from 'node:fs'

const auth = fs.readFileSync('src/lib/admin/require-evaluation-reviewer.ts', 'utf8')
const route = fs.readFileSync('src/app/api/admin/evaluation-review/route.ts', 'utf8')
const page = fs.readFileSync('src/app/dashboard/evaluation/page.tsx', 'utf8')
const atomicSql = fs.readFileSync('db/migrations/2026_07_14_atomic_human_review.sql', 'utf8')

assert.match(auth, /configured\.length === 0/)
assert.match(auth, /status: 503/)
assert.match(auth, /configured\.includes\(user\.email\.toLowerCase\(\)\)/)
assert.match(route, /createServiceRoleClient/)
assert.match(route, /human_certification !== true/)
assert.match(route, /model_generated_labels_forbidden: true/)
assert.match(route, /\^https:\\\/\\\//)
assert.match(route, /submit_human_evaluation_judgment/)
assert.match(route, /row\.cohort === 'v5_output'/)
assert.match(route, /row\.cohort === 'adversarial'/)
assert.match(page, /nessun modello ha scelto l’etichetta/i)
assert.match(atomicSql, /EVALUATION_CASE_NOT_READY/)
assert.match(atomicSql, /model_generated_labels_forbidden/)
assert.match(atomicSql, /is_human\s*=\s*true/)
assert.match(atomicSql, /revoke all on function public\.submit_human_evaluation_judgment/)
console.log('Evaluation review security: 15/15 OK')
