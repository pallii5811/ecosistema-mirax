#!/usr/bin/env node
/**
 * 50 query utente reale — tipologie diverse (hiring, gare, settore, CRM, registro, ads, sito, ricerca pura).
 * Run: node scripts/test-50-real-user-queries.mjs
 */
import { parseSignalIntentHeuristic, assertIntentCase } from './lib/signal-intent-parser.mjs'

const NO_SIGNAL = ['hiring', 'sector_investment', 'tender_won', 'crm_change', 'crm_detected', 'registry_change', 'site_stale', 'google_ads_started', 'meta_ads_started', 'investing_marketing']

/** @type {Array<{id:string, type:string, query:string, mustInclude?:string[], mustExclude?:string[], hiring_roles?:string[], sector_keywords?:string[], crm_keywords?:string[], time_window_days?:number|null, require_crm_change?:boolean, signalsExact?:string[]}>} */
const CASES = [
  // ── HIRING (10) ──
  { id: 'H01', type: 'hiring', query: 'cercami aziende in hiring per sviluppatori Python Milano', mustInclude: ['hiring'], hiring_roles: ['programmatore'] },
  { id: 'H02', type: 'hiring', query: 'offerte di lavoro per account manager Torino', mustInclude: ['hiring'], hiring_roles: ['commerciale'] },
  { id: 'H03', type: 'hiring', query: 'chi assume un recruiter a Roma', mustInclude: ['hiring'], hiring_roles: ['hr'] },
  { id: 'H04', type: 'hiring', query: 'aziende con job open per muratori Campania', mustInclude: ['hiring'], hiring_roles: ['tecnico'] },
  { id: 'H05', type: 'hiring', query: 'stanno recruitando marketing manager in Veneto', mustInclude: ['hiring'], hiring_roles: ['marketing'] },
  { id: 'H06', type: 'hiring', query: 'personale tecnico installatori con assunzioni attive Puglia', mustInclude: ['hiring'], hiring_roles: ['tecnico'] },
  { id: 'H07', type: 'hiring', query: 'cliniche private offerte lavoro infermieri Lazio', mustInclude: ['hiring'] },
  { id: 'H08', type: 'hiring', query: 'full stack backend developer in assunzione Emilia', mustInclude: ['hiring'], hiring_roles: ['programmatore'] },
  { id: 'H09', type: 'hiring', query: 'venditori B2B in assunzione Lombardia', mustInclude: ['hiring'], hiring_roles: ['commerciale'] },
  { id: 'H10', type: 'hiring', query: 'azienda cerca seo copywriter growth Milano', mustInclude: ['hiring'], hiring_roles: ['marketing'] },

  // ── GARE / APPALTI (6) ──
  { id: 'T01', type: 'tender', query: 'aggiudicatari appalto pulizie scuole Liguria', mustInclude: ['tender_won'] },
  { id: 'T02', type: 'tender', query: 'vincitori gara MEPA ultimo anno Campania', mustInclude: ['tender_won'], time_window_days: 365 },
  { id: 'T03', type: 'tender', query: 'lavori pubblici aggiudicati Sicilia', mustInclude: ['tender_won'] },
  { id: 'T04', type: 'tender', query: 'bando ANAC aggiudicazione costruzioni Abruzzo', mustInclude: ['tender_won'] },
  { id: 'T05', type: 'tender', query: 'appalti pubblica amministrazione ultimi 90 giorni', mustInclude: ['tender_won'], time_window_days: 90 },
  { id: 'T06', type: 'tender', query: 'impresa aggiudicataria gara manutenzione strade', mustInclude: ['tender_won'] },

  // ── INVESTIMENTO SETTORE (8) ──
  { id: 'S01', type: 'sector', query: 'aziende che investono in intelligenza artificiale generativa', mustInclude: ['sector_investment'] },
  { id: 'S02', type: 'sector', query: 'espansione in automazione industriale Emilia Romagna', mustInclude: ['sector_investment'] },
  { id: 'S03', type: 'sector', query: 'investimento pannelli solari PMI Veneto', mustInclude: ['sector_investment'], sector_keywords: ['fotovoltaico'] },
  { id: 'S04', type: 'sector', query: 'startup energia pulita con investimenti attivi', mustInclude: ['sector_investment'] },
  { id: 'S05', type: 'sector', query: 'machine learning investimento Nord Italia', mustInclude: ['sector_investment'] },
  { id: 'S06', type: 'sector', query: 'imprese rinnovabili che investono in Piemonte', mustInclude: ['sector_investment'] },
  { id: 'S07', type: 'sector', query: 'SaaS cloud investimento scaleup Lombardia', mustInclude: ['sector_investment'], sector_keywords: ['software'] },
  { id: 'S08', type: 'sector', query: 'logistica investimento hub intermodale Veneto', mustInclude: ['sector_investment'], sector_keywords: ['logistica'] },

  // ── CRM (6) ──
  { id: 'C01', type: 'crm', query: 'aziende con Pipedrive in Marche', mustInclude: ['crm_detected'], crm_keywords: ['pipedrive'] },
  { id: 'C02', type: 'crm', query: 'clienti Microsoft Dynamics 365 Toscana', mustInclude: ['crm_detected'], crm_keywords: ['dynamics'] },
  { id: 'C03', type: 'crm', query: 'switch CRM verso HubSpot recente', mustInclude: ['crm_change'], crm_keywords: ['hubspot'], require_crm_change: true },
  { id: 'C04', type: 'crm', query: 'sostituito CRM con Salesforce ultimi 30 giorni', mustInclude: ['crm_change'], crm_keywords: ['salesforce'], time_window_days: 30, require_crm_change: true },
  { id: 'C05', type: 'crm', query: 'nuovo CRM Pipedrive implementato ultimi 60 giorni', mustInclude: ['crm_change'], crm_keywords: ['pipedrive'], time_window_days: 60, require_crm_change: true },
  { id: 'C06', type: 'crm', query: 'migrato su Zoho negli ultimi 90 giorni', mustInclude: ['crm_change'], crm_keywords: ['zoho'], time_window_days: 90, require_crm_change: true },

  // ── REGISTRO / BILANCI (5) ──
  { id: 'R01', type: 'registry', query: 'bilancio in crescita ultimi 12 mesi Veneto', mustInclude: ['registry_change'], time_window_days: 360 },
  { id: 'R02', type: 'registry', query: 'fatturato aumentato camera di commercio Lombardia', mustInclude: ['registry_change'] },
  { id: 'R03', type: 'registry', query: 'dipendenti in aumento registro imprese Lazio', mustInclude: ['registry_change'] },
  { id: 'R04', type: 'registry', query: 'startup tech con crescita organico ultimo anno', mustInclude: ['registry_change'] },
  { id: 'R05', type: 'registry', query: 'storico bilancio positivo PMI manifattura', mustInclude: ['registry_change'] },

  // ── ADS / MARKETING (5) ──
  { id: 'A01', type: 'ads', query: 'campagne google attive settore food Parma', mustInclude: ['google_ads_started'] },
  { id: 'A02', type: 'ads', query: 'facebook ads attive e-commerce Modena', mustInclude: ['meta_ads_started'] },
  { id: 'A03', type: 'ads', query: 'instagram ads profumerie Milano', mustInclude: ['meta_ads_started'] },
  { id: 'A04', type: 'ads', query: 'PMI che spendono in pubblicità online B2B', mustInclude: ['investing_marketing'] },
  { id: 'A05', type: 'ads', query: 'retail con budget marketing elevato Torino', mustInclude: ['investing_marketing'] },

  // ── SITO DATATO (4) ──
  { id: 'W01', type: 'site', query: 'sito web obsoleto aziende manifatturiere Brescia', mustInclude: ['site_stale'] },
  { id: 'W02', type: 'site', query: 'sito non aggiornato copyright datato Umbria', mustInclude: ['site_stale'] },
  { id: 'W03', type: 'site', query: 'performance sito scarso hotel alpine Trentino', mustInclude: ['site_stale'] },
  { id: 'W04', type: 'site', query: 'caricamento lento sito corporate Padova', mustInclude: ['site_stale'] },

  // ── COMBO multi-segnale (3) ──
  { id: 'X01', type: 'combo', query: 'edili vincitori gara assumono muratori Veneto', mustInclude: ['tender_won', 'hiring'], hiring_roles: ['tecnico'] },
  { id: 'X02', type: 'combo', query: 'fotovoltaico investimento e assunzioni tecnici installatori', mustInclude: ['sector_investment', 'hiring'], sector_keywords: ['fotovoltaico'], hiring_roles: ['tecnico'] },
  { id: 'X03', type: 'combo', query: 'HubSpot CRM e Google Ads attivi agenzie marketing Roma', mustInclude: ['crm_detected', 'google_ads_started'], crm_keywords: ['hubspot'] },

  // ── RICERCA PURA — no intent (8) ──
  { id: 'N01', type: 'neutral', query: 'elettricisti Milano hinterland', mustExclude: NO_SIGNAL },
  { id: 'N02', type: 'neutral', query: 'avvocati divorzisti Roma centro', mustExclude: NO_SIGNAL },
  { id: 'N03', type: 'neutral', query: 'parrucchieri Napoli Vomero', mustExclude: NO_SIGNAL },
  { id: 'N04', type: 'neutral', query: 'meccanici auto Torino corso Francia', mustExclude: NO_SIGNAL },
  { id: 'N05', type: 'neutral', query: 'catering eventi Firenze centro', mustExclude: NO_SIGNAL },
  { id: 'N06', type: 'neutral', query: 'agenzie immobiliari Bologna', mustExclude: NO_SIGNAL },
  { id: 'N07', type: 'neutral', query: 'fiorai Bergamo bassa', mustExclude: NO_SIGNAL },
  { id: 'N08', type: 'neutral', query: 'studi notarili Padova', mustExclude: NO_SIGNAL },
]

let passed = 0
let failed = 0
const issues = []
const byType = new Map()

function ok(msg) {
  passed++
  console.log(`  ✓ ${msg}`)
}
function fail(id, detail) {
  failed++
  issues.push(`${id}: ${detail}`)
  console.error(`  ✗ ${id} — ${detail}`)
}

console.log('══════════════════════════════════════════════════')
console.log('50 QUERY UTENTE REALE — tipologie diverse')
console.log('══════════════════════════════════════════════════\n')

for (const c of CASES) {
  const spec = parseSignalIntentHeuristic(c.query)
  const caseOk = assertIntentCase(spec, c, fail, ok)
  if (caseOk) {
    ok(`${c.id} [${c.type}] [${spec.required_signals.join(', ') || '—'}] "${c.query.slice(0, 48)}…"`)
    byType.set(c.type, (byType.get(c.type) || 0) + 1)
  }
}

console.log('\n━━━ Riepilogo per tipologia ━━━')
for (const [type, count] of [...byType.entries()].sort()) {
  const total = CASES.filter((c) => c.type === type).length
  console.log(`  ${type}: ${count}/${total} OK`)
}

console.log('\n══════════════════════════════════════════════════')
const pct = Math.round((passed / (passed + failed)) * 100)
console.log(`Totale: ${passed} check OK, ${failed} FAIL — accuratezza ${pct}%`)
if (issues.length) {
  console.log('\nIssue:')
  issues.forEach((i) => console.log(`  • ${i}`))
}
process.exit(failed > 0 ? 1 : 0)
