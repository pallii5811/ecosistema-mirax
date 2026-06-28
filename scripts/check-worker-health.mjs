/**
 * Blocco 9 — health check backend worker/API (staging/prod).
 * Prova /health, fallback /openapi.json per compatibilità deploy precedenti.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(ROOT, '.env.local')

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const env = fs.existsSync(ENV_PATH) ? parseEnv(fs.readFileSync(ENV_PATH, 'utf8')) : {}
const backend = (env.BACKEND_URL || process.env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/+$/, '')

async function probe(pathSuffix) {
  const url = `${backend}${pathSuffix}`
  const start = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const body = await res.text().catch(() => '')
  return { url, ok: res.ok, status: res.status, latency: Date.now() - start, body }
}

let result = await probe('/health')
if (!result.ok) {
  const fallback = await probe('/openapi.json')
  if (fallback.ok) {
    console.log(
      `[check-worker-health] OK (fallback openapi) ${fallback.url} (${fallback.latency}ms) — /health non ancora deployato`,
    )
    process.exit(0)
  }
  console.error(`[check-worker-health] FAIL /health=${result.status}, openapi=${fallback.status}`)
  process.exit(1)
}

console.log(`[check-worker-health] OK ${result.url} (${result.latency}ms) — ${result.body.slice(0, 120)}`)
