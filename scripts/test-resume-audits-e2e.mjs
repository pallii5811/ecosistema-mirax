/**
 * E2E smoke test: audit 1 pending lead on a real job via Hetzner /audit-url
 * and write back to Supabase (same logic as /api/resume-audits).
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  }),
)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKEND = env.BACKEND_URL || 'http://116.203.137.39:8001'
const JOB_ID = process.argv[2] || '90dced83-b359-4888-9948-39b77eca605f'

function isPending(lead) {
  const ts = Array.isArray(lead?.tech_stack) ? lead.tech_stack.join(' ').toLowerCase() : ''
  return ts.includes('verifica in corso') || ts.includes('audit in arrivo')
}

function buildTechStack(audit) {
  const ts = []
  if (audit.has_ssl !== false) ts.push('SSL')
  ts.push(audit.has_pixel ? 'Meta Pixel' : 'MISSING FB PIXEL')
  ts.push(audit.has_gtm ? 'GTM' : 'MISSING GTM')
  ts.push(audit.has_google_ads ? 'GOOGLE ADS' : 'MISSING GOOGLE ADS')
  return ts
}

const { data: job, error } = await sb.from('searches').select('id,status,results').eq('id', JOB_ID).single()
if (error || !job) {
  console.error('Job not found', error?.message)
  process.exit(1)
}

const results = Array.isArray(job.results) ? [...job.results] : []
const idx = results.findIndex((l) => isPending(l) && String(l.sito || l.website || '').trim())
if (idx < 0) {
  console.log('No pending lead with website — nothing to test')
  process.exit(0)
}

const lead = results[idx]
const site = String(lead.sito || lead.website).trim()
const url = site.startsWith('http') ? site : `https://${site}`
console.log('Auditing:', lead.azienda || lead.business_name, url)

const res = await fetch(`${BACKEND}/audit-url`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url }),
  signal: AbortSignal.timeout(90_000),
})

if (!res.ok) {
  console.error('Hetzner audit failed', res.status, await res.text())
  process.exit(1)
}

const audit = await res.json()
results[idx] = {
  ...lead,
  tech_stack: buildTechStack(audit),
  meta_pixel: Boolean(audit.has_pixel),
  google_tag_manager: Boolean(audit.has_gtm),
  technical_report: { ...(lead.technical_report || {}), has_google_ads: Boolean(audit.has_google_ads) },
  last_audited_at: new Date().toISOString(),
}

const pendingAfter = results.filter(isPending).length
const { error: upErr } = await sb.from('searches').update({
  results,
  status: pendingAfter === 0 ? 'completed' : 'processing',
}).eq('id', JOB_ID)

if (upErr) {
  console.error('Supabase update failed', upErr.message)
  process.exit(1)
}

console.log('OK — audited 1 lead. Pending remaining:', pendingAfter)
console.log('New tech_stack:', results[idx].tech_stack.join(', '))
