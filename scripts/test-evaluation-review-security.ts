import assert from 'node:assert/strict'
import fs from 'node:fs'

const auth = fs.readFileSync('src/lib/admin/require-evaluation-reviewer.ts', 'utf8')
const route = fs.readFileSync('src/app/api/admin/evaluation-review/route.ts', 'utf8')
const page = fs.readFileSync('src/app/dashboard/evaluation/page.tsx', 'utf8')

assert.match(auth, /configured\.length === 0/)
assert.match(auth, /status: 503/)
assert.match(auth, /configured\.includes\(user\.email\.toLowerCase\(\)\)/)
assert.match(route, /createServiceRoleClient/)
assert.match(route, /human_certification !== true/)
assert.match(route, /is_human: true/)
assert.match(route, /model_generated_labels_forbidden: true/)
assert.match(route, /\^https:\\\/\\\//)
assert.match(route, /onConflict: 'case_id,run_id,judge_id'/)
assert.match(page, /nessun modello ha scelto l’etichetta/i)
console.log('Evaluation review security: 10/10 OK')
