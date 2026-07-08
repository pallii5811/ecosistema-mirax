#!/usr/bin/env node
/**
 * Fase 7 — Quality Monitoring smoke test.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

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

assert(hasFile('src/lib/universe/quality.ts'), 'quality.ts module exists')
assert(hasFile('src/app/api/universe/quality/route.ts'), 'quality API route exists')

// Import the module and verify exports.
const quality = await import(pathToFileURL(path.join(ROOT, 'src/lib/universe/quality.ts')).href)
assert(typeof quality.getUniverseQualityMetrics === 'function', 'getUniverseQualityMetrics exported')
assert(typeof quality.getSearchQualityMetrics === 'function', 'getSearchQualityMetrics exported')
assert(typeof quality.getUserLearningMetrics === 'function', 'getUserLearningMetrics exported')

console.log('\n[test-universe-quality] OK')
