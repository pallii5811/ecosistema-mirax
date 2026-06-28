/**
 * Test business events collectors (Fase 1-A) — standalone, no TS path aliases
 * Run: node scripts/test-business-events.mjs
 */

import assert from 'node:assert/strict'

function detectSiteStale(lead) {
  const signals = []
  const website = lead.sito || lead.website
  if (!website) return signals
  const tr = lead.technical_report || {}
  const loadSpeed = tr.load_speed_seconds
  if (typeof loadSpeed === 'number' && loadSpeed >= 4.5) {
    signals.push({ signalType: 'site_stale', evidence: [{ label: 'Velocità', value: String(loadSpeed), source: 'website_audit' }] })
  }
  const snippet = tr.html_snippet || ''
  const m = snippet.match(/©\s*(\d{4})/i)
  if (m && Number(m[1]) <= new Date().getFullYear() - 2) {
    signals.push({ signalType: 'site_stale', evidence: [{ label: 'Copyright', value: m[1], source: 'website_audit' }] })
  }
  return signals
}

function detectGoogleAds(lead) {
  if (lead.google_ads === true || lead.technical_report?.has_google_ads === true) {
    return [{ signalType: 'google_ads_started', evidence: [{ label: 'Google Ads', value: 'sì', source: 'website_audit' }] }]
  }
  return []
}

function detectRegistry(lead) {
  const storico = lead.storico_bilanci
  if (!Array.isArray(storico) || storico.length < 2) return []
  const [latest, prev] = storico.sort((a, b) => b.anno - a.anno)
  if (latest.dipendenti > prev.dipendenti) {
    const growth = Math.round(((latest.dipendenti - prev.dipendenti) / prev.dipendenti) * 100)
    if (growth >= 15) {
      return [{ signalType: 'registry_change', evidence: [{ label: 'Crescita dip.', value: `+${growth}%`, source: 'openapi_it' }] }]
    }
  }
  return []
}

function detectHiring(lead) {
  if (typeof lead.dipendenti === 'number' && lead.dipendenti >= 15) {
    return [{ signalType: 'hiring', evidence: [{ label: 'Dipendenti', value: String(lead.dipendenti), source: 'openapi_it' }] }]
  }
  return []
}

const samples = [
  {
    label: 'Sito lento + copyright datato',
    lead: {
      sito: 'https://example-edil.it',
      technical_report: { load_speed_seconds: 5.2, html_snippet: '© 2019 Edil Costruzioni' },
    },
    expect: ['site_stale'],
  },
  {
    label: 'Google Ads attivo',
    lead: { google_ads: true, technical_report: { has_google_ads: true } },
    expect: ['google_ads_started'],
  },
  {
    label: 'Crescita registro',
    lead: {
      dipendenti: 28,
      storico_bilanci: [
        { anno: 2024, dipendenti: 28 },
        { anno: 2023, dipendenti: 20 },
      ],
    },
    expect: ['registry_change', 'hiring'],
  },
]

let passed = 0
for (const s of samples) {
  const all = [...detectSiteStale(s.lead), ...detectGoogleAds(s.lead), ...detectRegistry(s.lead), ...detectHiring(s.lead)]
  const types = new Set(all.map((x) => x.signalType))
  const hasEvidence = all.every((x) => x.evidence?.length > 0)
  assert.ok(s.expect.every((t) => types.has(t)), `${s.label}: expected ${s.expect.join(',')}, got ${[...types].join(',')}`)
  assert.ok(hasEvidence, `${s.label}: missing evidence`)
  console.log(`✓ ${s.label}`)
  passed += 1
}

console.log(`\n[test-business-events] ${passed}/${samples.length} OK`)
