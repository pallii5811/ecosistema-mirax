#!/usr/bin/env node
/**
 * Suite completa ecosistema — unit test blocchi 1–9 + env + worker + build opzionale.
 * Usage: node scripts/test-ecosistema-all.mjs [--e2e] [--build]
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const failed = []

function run(name, cmd) {
  console.log(`\n━━━ ${name} ━━━`)
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env })
    console.log(`✅ ${name}`)
  } catch {
    failed.push(name)
    console.error(`❌ ${name}`)
  }
}

const suites = [
  ['Block 1 unit', 'npm run test:block1:unit'],
  ['Block 2 unit', 'npm run test:block2:unit'],
  ['Block 3 unit', 'npm run test:block3:unit'],
  ['Block 4 unit', 'npm run test:block4:unit'],
  ['Block 5 unit', 'npm run test:block5:unit'],
  ['Block 6 unit', 'npm run test:block6:unit'],
  ['Block 7 unit', 'npm run test:block7:unit'],
  ['Block 8 unit', 'npm run test:block8:unit'],
  ['Block 9 unit', 'npm run test:block9:unit'],
  ['Staging env', 'npm run check:staging-env'],
  ['Worker health', 'npm run check:worker-health'],
]

for (const [name, cmd] of suites) run(name, cmd)

if (args.has('--e2e')) {
  run('Block 1 E2E staging', 'npm run test:block1:e2e')
  if (fs.existsSync(path.join(ROOT, 'scripts/test-resume-audits-e2e.mjs'))) {
    run('Resume audits E2E', 'node scripts/test-resume-audits-e2e.mjs')
  }
}

if (args.has('--build')) {
  run('Next.js build', 'npm run build')
}

console.log('\n══════════════════════════════════════')
if (failed.length === 0) {
  console.log('✅ ECOSISTEMA ALL PASS —', suites.length + (args.has('--e2e') ? '+e2e' : ''), 'checks')
  process.exit(0)
}
console.error('❌ FAILED:', failed.join(', '))
process.exit(1)
