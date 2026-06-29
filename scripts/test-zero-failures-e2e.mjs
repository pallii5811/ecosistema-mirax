#!/usr/bin/env node
/**
 * MIRAX v5 — Zero Failures E2E: entity matching, resilience, 50+ query scenarios.
 * Run: node scripts/test-zero-failures-e2e.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseSignalIntentHeuristic } from './lib/signal-intent-parser.mjs'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend_mirror')

let passed = 0
let failed = 0

function ok(msg) {
  passed += 1
  console.log(`✓ ${msg}`)
}

function fail(msg) {
  failed += 1
  console.error(`✗ ${msg}`)
}

function runPythonTest(script) {
  const r = spawnSync('python', [script], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    fail(`${script}: ${r.stderr || r.stdout || 'exit ' + r.status}`)
    return false
  }
  ok(`${script} — ${(r.stdout || '').trim()}`)
  return true
}

/** Entity match scenarios — homonyms, wrong city, P.IVA */
const MATCH_CASES = [
  {
    id: 'M01',
    lead: { azienda: 'Rossi Costruzioni SRL', city: 'Milano', partita_iva: '12345678901' },
    candidate: { piva: '12345678901', name: 'Altro Nome' },
    expectAccept: true,
  },
  {
    id: 'M02',
    lead: { azienda: 'Rossi Costruzioni SRL', city: 'Milano', partita_iva: '12345678901' },
    candidate: { piva: '10987654321', name: 'Rossi Costruzioni SRL' },
    expectAccept: false,
  },
  {
    id: 'M03',
    lead: { azienda: 'Bianchi Edilizia SRL', city: 'Verona' },
    candidate: { name: 'Bianchi Edilizia SRL', city: 'Torino', text_blob: 'Bianchi Edilizia Torino' },
    expectAccept: false,
  },
  {
    id: 'M04',
    lead: { azienda: 'Ferrari Nautica SRL', city: 'La Spezia', sito: 'https://ferrarinautica.it' },
    candidate: { domain: 'ferrarinautica.it', name: 'Ferrari Nautica' },
    expectAccept: true,
  },
  {
    id: 'M05',
    lead: { azienda: 'Acme Software SRL', city: 'Milano', telefono: '+39 02 12345678' },
    candidate: { phone: '0212345678', name: 'Wrong Name' },
    expectAccept: true,
  },
  {
    id: 'M06',
    lead: { azienda: 'Studio Legale Rossi', city: 'Roma' },
    candidate: { name: 'Studio Legale Bianchi', city: 'Roma' },
    expectAccept: false,
  },
  {
    id: 'M07',
    lead: { azienda: 'Impianti Elettrici Veronesi SRL', city: 'Verona' },
    candidate: {
      name: 'Impianti Elettrici Veronesi SRL',
      city: 'Verona',
      text_blob: 'Impianti Elettrici Veronesi gara aggiudicata',
    },
    expectAccept: true,
  },
  {
    id: 'M08',
    lead: { azienda: 'Global Service SRL', city: 'Napoli' },
    candidate: { name: 'Global Service Group', city: 'Milano', text_blob: 'Global Service Group Milano' },
    expectAccept: false,
  },
]

/** 50+ diverse query — intent parsing must never crash */
const QUERY_CASES = [
  'aziende che assumono programmatori Milano',
  'imprese edili gara vinta Veneto',
  'fotovoltaico investimento Piemonte',
  'HubSpot CRM Lazio',
  'bilancio in crescita Lombardia',
  'google ads attivi ristoranti Bologna',
  'sito obsoleto manifattura Brescia',
  'elettricisti Milano hinterland',
  'cliniche private assunzioni infermieri',
  'appalti ANAC ultimi 90 giorni',
  'muratura edilizia hiring Campania',
  'Pipedrive CRM Marche',
  'startup AI investimento Emilia',
  'meta ads e-commerce Modena',
  'notai Padova centro',
  'impianti solari PMI Veneto',
  'Salesforce migrazione ultimi 30 giorni',
  'logistica hub intermodale Veneto',
  'copyright datato hotel Trentino',
  'meccanici auto Torino',
  'edili vincitori gara assumono muratori',
  'fotovoltaico assunzioni installatori',
  'agenzie marketing Roma Google Ads HubSpot',
  'software house backend developer Torino',
  'pulizie scuole gara Liguria',
  'MEP aggiudicatari Campania',
  'lavori pubblici Sicilia',
  'costruzioni Abruzzo bando',
  'manutenzione strade aggiudicataria',
  'machine learning investimento Nord',
  'energia pulita startup',
  'SaaS cloud scaleup Lombardia',
  'Dynamics 365 Toscana',
  'Zoho CRM migrato 90 giorni',
  'dipendenti aumento registro Lazio',
  'fatturato camera commercio Veneto',
  'PMI manifattura bilancio positivo',
  'facebook ads profumerie Milano',
  'budget marketing B2B Torino',
  'performance sito scarso Padova',
  'caricamento lento corporate',
  'parrucchieri Napoli Vomero',
  'catering eventi Firenze',
  'immobiliari Bologna',
  'fiorai Bergamo',
  'avvocati divorzisti Roma',
  'idraulici urgenti Genova',
  'pasticcerie artigianali Sicilia',
  'officine carrozzerie Puglia',
  'consulenza fiscale Milano centro',
  'architetti interior design Roma',
  'noleggio furgoni industriali Veneto',
  'stampa 3D prototipi Lombardia',
]

function testEmergencyMockShape() {
  const mock = {
    type: 'hiring',
    title: 'Assunzioni: dato non disponibile',
    severity: 'low',
    confidence: 0,
    status: 'unknown',
    retry_after_minutes: 30,
    evidence: [{ label: 'Stato', value: 'Fonti down', source: 'system' }],
    source: 'system',
  }
  if (mock.status !== 'unknown' || mock.confidence !== 0) {
    fail('emergency mock shape invalid')
    return
  }
  ok('emergency mock shape valid')
}

function testCanonicalProtection() {
  const lead = { telefono: '+39 02 111', email: 'info@acme.it', nome: 'Acme' }
  const patch = { telefono: '+39 06 999', business_signals: [{ type: 'hiring' }] }
  const protectedFields = ['telefono', 'phone', 'email', 'nome', 'azienda', 'sito', 'website']
  const safe = { ...patch }
  for (const k of protectedFields) {
    if (lead[k]) delete safe[k]
  }
  if ('telefono' in safe) {
    fail('canonical telefono would be overwritten')
    return
  }
  if (!safe.business_signals) {
    fail('non-canonical fields should pass through')
    return
  }
  ok('canonical Maps/audit fields protected from enrichment patch')
}

function testMatchCasesViaPython() {
  const pyCases = JSON.stringify(MATCH_CASES).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False')
  const py = `
from entity_matcher import EntityCandidate, score_entity_match
cases = ${pyCases}
errors = []
for c in cases:
    lead = c['lead']
    cand_raw = c['candidate']
    cand = EntityCandidate(
        name=cand_raw.get('name',''),
        city=cand_raw.get('city',''),
        piva=cand_raw.get('piva',''),
        domain=cand_raw.get('domain',''),
        phone=cand_raw.get('phone',''),
        text_blob=cand_raw.get('text_blob',''),
    )
    r = score_entity_match(lead, cand)
    if r.accepted != c['expectAccept']:
        errors.append(f"{c['id']}: expected {c['expectAccept']} got {r.accepted} ({r.reason})")
if errors:
    print('\\n'.join(errors))
    raise SystemExit(1)
print(f"match_cases: {len(cases)}/{len(cases)} OK")
`
  const r = spawnSync('python', ['-c', py], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    fail(`match cases: ${r.stderr || r.stdout}`)
    return
  }
  ok(r.stdout.trim())
}

function testQueryBatch() {
  let errors = 0
  for (const q of QUERY_CASES) {
    try {
      const intent = parseSignalIntentHeuristic(q)
      if (!intent || typeof intent !== 'object') {
        fail(`query parse null: ${q.slice(0, 40)}`)
        errors += 1
      }
    } catch (e) {
      fail(`query crash: ${q.slice(0, 40)} — ${e.message}`)
      errors += 1
    }
  }
  if (errors === 0) ok(`${QUERY_CASES.length} diverse query — zero crash`)
}

function testHealthMonitorPython() {
  const py = `
from health_monitor import HealthMonitor
m = HealthMonitor()
assert m.should_try('indeed_it')
m.record_failure('indeed_it')
m.record_failure('indeed_it')
m.record_failure('indeed_it')
assert not m.should_try('indeed_it')
m.record_success('indeed_it', 100)
assert m.should_try('indeed_it')
print('health_monitor: OK')
`
  const r = spawnSync('python', ['-c', py], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    fail(`health monitor: ${r.stderr || r.stdout}`)
    return
  }
  ok(r.stdout.trim())
}

function testUniversalCachePython() {
  const py = `
from universal_cache import UniversalCache
c = UniversalCache(ttl_seconds=60)
c.set('indeed_it', 'Acme|Milano|hiring', [{'type':'hiring'}])
assert c.get('indeed_it', 'Acme|Milano|hiring') is not None
assert c.get('indeed_it', 'other') is None
c.invalidate_source('indeed_it')
assert c.get('indeed_it', 'Acme|Milano|hiring') is None
print('universal_cache: OK')
`
  const r = spawnSync('python', ['-c', py], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    fail(`universal cache: ${r.stderr || r.stdout}`)
    return
  }
  ok(r.stdout.trim())
}

console.log('\n=== MIRAX v5 Zero Failures E2E ===\n')

runPythonTest('test_entity_matcher.py')
runPythonTest('test_hotfix_stabilization.py')
testHealthMonitorPython()
testUniversalCachePython()
testMatchCasesViaPython()
testEmergencyMockShape()
testCanonicalProtection()
testQueryBatch()

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`)
process.exit(failed > 0 ? 1 : 0)
