#!/usr/bin/env node
/**
 * Fase 6/7 — Feedback Loop + Quality Monitoring smoke test.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond, msg) {
  if (!cond) {
    console.error('✗', msg)
    process.exit(1)
  }
  console.log('✓', msg)
}

function hasFile(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

assert(hasFile('src/lib/universe/feedback.ts'), 'feedback.ts module exists')
assert(hasFile('src/app/api/universe/feedback/route.ts'), 'feedback API route exists')
assert(hasFile('db/migrations/2026_12_21_user_feedback.sql'), 'user_feedback migration exists')
assert(hasFile('src/lib/universe/quality.ts'), 'quality.ts module exists')
assert(hasFile('src/app/api/universe/quality/route.ts'), 'quality API route exists')

const migration = readFile('db/migrations/2026_12_21_user_feedback.sql')
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.universe_feedback'), 'migration creates universe_feedback')
assert(migration.includes('ENABLE ROW LEVEL SECURITY'), 'feedback RLS enabled')
assert(migration.includes('universe_feedback_owner'), 'feedback owner policy exists')

const applyScript = readFile('scripts/apply-mirax-migrations.mjs')
assert(applyScript.includes('2026_12_21_user_feedback.sql'), 'apply-mirax-migrations includes feedback migration')

const feedbackMod = readFile('src/lib/universe/feedback.ts')
assert(feedbackMod.includes('FEEDBACK_ACTION_WEIGHTS'), 'feedback weights defined')
assert(feedbackMod.includes('applyFeedbackBoost'), 'applyFeedbackBoost exported')
assert(feedbackMod.includes('buildFeedbackPromptExamples'), 'buildFeedbackPromptExamples exported')

const qualityMod = readFile('src/lib/universe/quality.ts')
assert(qualityMod.includes('getUniverseQualityMetrics'), 'getUniverseQualityMetrics exported')
assert(qualityMod.includes('getSearchQualityMetrics'), 'getSearchQualityMetrics exported')

console.log('\n[test-universe-feedback] OK')
