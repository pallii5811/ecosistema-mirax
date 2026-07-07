/**
 * Server-only deterministic hashing for cross-runtime idempotency.
 *
 * Mirrors Python's:
 *   json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str)
 *   hashlib.md5(...).hexdigest()
 */

import { createHash } from 'node:crypto'

function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return 'null'
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']'
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${deterministicStringify(obj[k])}`)
  return '{' + pairs.join(',') + '}'
}

export function stablePayloadHash(payload: unknown): string {
  return createHash('md5').update(deterministicStringify(payload)).digest('hex')
}
