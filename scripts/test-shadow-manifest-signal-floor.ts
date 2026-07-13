import assert from 'node:assert/strict'
import fs from 'node:fs'

import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'
import { canonicalSignalId } from '../src/lib/signal-ontology/ontology'

const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8')) as {
  canaries: Array<{ vertical: string; query: string; expected_signal_any: string[] }>
}

for (const spec of manifest.canaries) {
  const parsed = parseSignalIntentHeuristic(spec.query)
  const canonical = [...new Set(parsed.required_signals.map((signal) => canonicalSignalId(signal) || signal))]
  const matched = canonical.filter((signal) => spec.expected_signal_any.includes(signal))
  const unexpected = canonical.filter((signal) => !spec.expected_signal_any.includes(signal))
  assert.ok(matched.length > 0, `${spec.vertical}: deterministic signal floor misses allowlist; got ${canonical.join(',')}`)
  assert.deepEqual(unexpected, [], `${spec.vertical}: seller/buyer contamination or overly generic signal: ${unexpected.join(',')}`)
}

console.log(`Shadow manifest deterministic signal floor: ${manifest.canaries.length}/10 PASS`)
