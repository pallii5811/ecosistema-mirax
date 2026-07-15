#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const ROOT = new URL('../', import.meta.url)
const DATASET_VERSION = 'mirax-live-source-adapter-v5'
const HARD_BUDGET_EUR = 0.125
const TARGET_COST_EUR = 0.105
const REQUESTED_COUNT = 5

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
const action = args.get('action') || 'status'
const vertical = args.get('vertical') || ''

const SPECS = {
  procurement: {
    query: 'Trovami imprese edili italiane che hanno vinto gare pubbliche negli ultimi 30 giorni.',
    industries: ['edilizia', 'costruzioni'],
    geographies: ['Italia'],
    signals: ['tender_won'],
    freshness: { tender_won: 30 },
    preferredSources: ['public_procurement_portal'],
    allowedSources: ['public_procurement_portal'],
    primarySources: ['tender_won'],
    requiredAttributes: ['impresa operativa nel settore edile'],
    buyerProblem: 'La recente aggiudicazione genera fabbisogni operativi, finanziari e commerciali immediati.',
    event: 'gara pubblica aggiudicata negli ultimi 30 giorni',
    impliedNeed: 'Capacita e servizi necessari per eseguire il contratto aggiudicato.',
  },
  hiring: {
    query: 'Trovami PMI italiane che stanno assumendo personale operativo con offerte attive e recenti.',
    industries: ['servizi operativi', 'industria', 'logistica', 'edilizia'],
    geographies: ['Italia'],
    signals: ['hiring_operational'],
    freshness: { hiring_operational: 30 },
    preferredSources: ['company_careers', 'job_board'],
    allowedSources: ['company_careers', 'job_board', 'official_company_website'],
    primarySources: ['hiring_operational'],
    requiredAttributes: ['PMI operativa', 'vacancy concreta e attiva'],
    buyerProblem: 'La selezione operativa attiva indica capacita insufficiente o crescita della domanda.',
    event: 'offerta di lavoro operativa attiva e recente',
    impliedNeed: 'Servizi e strumenti per sostenere recruiting, onboarding e crescita operativa.',
  },
  'hiring-sales': {
    query: 'Trovami aziende in Lombardia che stanno assumendo commerciali, sales manager o business developer.',
    industries: ['PMI e aziende B2B'],
    geographies: ['Lombardia', 'Italia'],
    signals: ['hiring_sales'],
    freshness: { hiring_sales: 60 },
    preferredSources: ['company_careers', 'job_board'],
    allowedSources: ['company_careers', 'job_board'],
    primarySources: ['hiring_sales'],
    requiredAttributes: ['azienda operativa in Lombardia', 'vacancy sales verificabile'],
    buyerProblem: 'La crescita commerciale richiede nuove figure di vendita con onboarding e pipeline attivi.',
    event: 'vacancy sales attiva su careers ufficiale o ATS pubblico',
    impliedNeed: 'Servizi per accelerare pipeline, onboarding commerciale e prioritizzazione outbound.',
  },
  'hiring-marketing': {
    query: 'Trovami aziende in Lombardia che stanno assumendo figure marketing, social media manager o performance marketer.',
    industries: ['PMI e aziende operative'],
    geographies: ['Lombardia', 'Italia'],
    signals: ['hiring_marketing'],
    freshness: { hiring_marketing: 60 },
    preferredSources: ['company_careers', 'job_board'],
    allowedSources: ['company_careers', 'job_board'],
    primarySources: ['hiring_marketing'],
    requiredAttributes: ['azienda operativa in Lombardia', 'vacancy marketing verificabile'],
    buyerProblem: 'Una vacancy marketing attiva segnala budget e pressione sui risultati commerciali.',
    event: 'vacancy marketing attiva su careers ufficiale o ATS pubblico',
    impliedNeed: 'Servizi per aumentare il ritorno del budget marketing e della crescita digitale.',
  },
  'digital-audit': {
    query: 'Trovami concessionari auto a Torino senza DMARC e senza Instagram.',
    industries: ['concessionari auto'],
    geographies: ['Torino', 'Italia'],
    signals: ['no_dmarc', 'missing_instagram'],
    freshness: { no_dmarc: 1, missing_instagram: 1 },
    preferredSources: ['technology_audit'],
    allowedSources: ['technology_audit', 'google_business_maps', 'official_company_website'],
    primarySources: ['no_dmarc', 'missing_instagram'],
    requiredAttributes: ['concessionario auto operativo a Torino'],
    buyerProblem: 'Lassenza simultanea di DMARC e Instagram crea rischi di sicurezza e visibilita digitale.',
    event: 'audit tecnico diretto del dominio e dei profili social',
    impliedNeed: 'Correzione della postura email e della presenza social ufficiale.',
  },
  expansion: {
    query: 'Trovami aziende italiane che hanno annunciato recentemente una nuova sede, un nuovo stabilimento o un ampliamento produttivo.',
    industries: ['industria', 'servizi B2B'],
    geographies: ['Italia'],
    signals: ['expansion'],
    freshness: { expansion: 90 },
    preferredSources: ['official_company_website', 'recognized_local_news'],
    allowedSources: ['official_company_website', 'recognized_local_news', 'industry_publication'],
    primarySources: ['expansion'],
    requiredAttributes: ['azienda operativa italiana'],
    buyerProblem: 'Una espansione concreta crea nuovi fabbisogni di capacita, fornitori e processi.',
    event: 'nuova sede, nuovo stabilimento o ampliamento produttivo annunciato di recente',
    impliedNeed: 'Servizi e infrastrutture per rendere operativa lespansione.',
  },
  'marketing-investment': {
    query: 'Trovami aziende in Lombardia che stanno investendo concretamente in marketing con prove recenti e verificabili.',
    industries: ['PMI e aziende operative'],
    geographies: ['Lombardia', 'Italia'],
    signals: ['investing_marketing'],
    freshness: { investing_marketing: 60 },
    preferredSources: ['official_company_website'],
    allowedSources: ['official_company_website', 'recognized_local_news', 'industry_publication'],
    primarySources: ['investing_marketing'],
    requiredAttributes: ['azienda operativa in Lombardia', 'investimento marketing esplicito'],
    buyerProblem: 'Un investimento marketing verificabile indica budget attivo e pressione sui risultati commerciali.',
    event: 'campagna, incarico, rebranding o assunzione marketing recente e verificabile',
    impliedNeed: 'Strumenti e servizi per aumentare il ritorno del budget marketing attivo.',
  },
  'multi-signal': {
    query: 'Trovami aziende italiane che hanno annunciato unespansione recente e stanno assumendo personale operativo.',
    industries: ['industria', 'logistica', 'servizi operativi'],
    geographies: ['Italia'],
    signals: ['expansion', 'hiring_operational'],
    freshness: { expansion: 90, hiring_operational: 30 },
    preferredSources: ['official_company_website', 'recognized_local_news', 'company_careers', 'job_board'],
    allowedSources: ['official_company_website', 'recognized_local_news', 'industry_publication', 'company_careers', 'job_board'],
    primarySources: ['expansion', 'hiring_operational'],
    requiredAttributes: ['azienda operativa italiana', 'due evidenze distinte per espansione e hiring operativo'],
    buyerProblem: 'Espansione e recruiting operativo simultanei indicano crescita concreta e fabbisogni immediati.',
    event: 'espansione recente e vacancy operativa attiva',
    impliedNeed: 'Capacita, strumenti e fornitori per sostenere una crescita gia in esecuzione.',
  },
}

function requireUuid(label, value) {
  if (!/^[0-9a-f-]{36}$/i.test(value || '')) throw new Error(`invalid ${label} id`)
  return value
}

function buildPlan(spec, searchId) {
  const fixture = JSON.parse(fs.readFileSync(new URL('contracts/fixtures/commercial-search-plan.valid.json', ROOT), 'utf8'))
  return {
    ...fixture,
    search_id: searchId,
    raw_query: spec.query,
    language: 'it',
    seller: {
      offer_category: 'b2b_commercial_intelligence',
      offer_description: 'Servizi B2B pertinenti al bisogno commerciale osservato con evidenza verificabile.',
      products_or_services: ['sales intelligence', 'servizi B2B specialistici'],
      problems_solved: ['prioritizzazione delle opportunita', 'attivazione commerciale tempestiva'],
      sales_motion: 'consultative_outbound',
      preferred_buyer_roles: ['titolare', 'direttore generale', 'responsabile operations'],
    },
    target: {
      entity_types: ['company'],
      industries: spec.industries,
      company_sizes: ['micro', 'small', 'medium'],
      employee_range: { min: 1, max: 249 },
      revenue_range: { max: 50000000, currency: 'EUR' },
      geographies: spec.geographies,
      local_business_preference: true,
      required_attributes: spec.requiredAttributes,
      excluded_attributes: ['grande gruppo globale', 'publisher', 'directory', 'ente pubblico'],
      excluded_entities: [],
    },
    commercial_hypotheses: [{
      id: `${vertical}-live-shadow`,
      buyer_problem: spec.buyerProblem,
      triggering_events: [spec.event],
      signals: spec.signals,
      implied_need: spec.impliedNeed,
      relevance_to_offer: 'Levidenza consente un contatto B2B contestuale, verificabile e temporalmente rilevante.',
      confidence: 0.9,
    }],
    signal_policy: {
      required_signals: spec.signals,
      optional_signals: [],
      negative_signals: ['business_closed'],
      maximum_age_days_by_signal: spec.freshness,
      minimum_signal_confidence: 0.75,
    },
    source_policy: {
      preferred_source_classes: spec.preferredSources,
      allowed_source_classes: spec.allowedSources,
      excluded_source_classes: ['generic_blog', 'directory', 'search_snippet'],
      minimum_independent_sources: spec.signals.length > 1 ? 2 : 1,
      primary_source_required_for: spec.primarySources,
    },
    evidence_policy: {
      require_official_domain: true,
      require_source_url: true,
      require_observed_at: true,
      minimum_evidence_confidence: 0.75,
      corroboration_required_above_risk: 0.65,
    },
    audit_policy: {
      modules: ['company_identity', 'commercial_signals', 'contacts', 'social_profiles'],
      crawl_depth: 1,
      maximum_pages: 8,
      collect_contacts: true,
      collect_social_profiles: true,
      detect_technologies: vertical === 'digital-audit',
      detect_commercial_signals: true,
    },
    ranking_policy: {
      weight_buyer_fit: 0.25,
      weight_signal_strength: 0.25,
      weight_freshness: 0.15,
      weight_evidence_confidence: 0.2,
      weight_contactability: 0.1,
      weight_need_gap: 0.05,
    },
    budget_policy: {
      target_cost_eur: TARGET_COST_EUR,
      hard_cost_eur: HARD_BUDGET_EUR,
      maximum_search_calls: 25,
      maximum_pages_opened: 50,
      maximum_llm_evaluations: 0,
    },
    ambiguity: { score: 0, assumptions: [], unresolved_fields: [] },
    planner_metadata: {
      planner: 'llm',
      prompt_version: 'source-adapter-live-prevalidated-v1',
      model: 'offline-prevalidated-no-llm-call',
      generated_at: new Date().toISOString(),
    },
  }
}

function validatePlanOffline(plan) {
  const code = [
    'import json,sys',
    'from backend_mirror.contracts.commercial_search_plan import validate_commercial_search_plan',
    'from backend_mirror.contracts.signal_ontology import validate_plan_signals',
    'from backend_mirror.contracts.source_registry import validate_plan_source_policy',
    'p=json.load(sys.stdin)',
    'v=validate_commercial_search_plan(p).model_dump(mode="json")',
    'validate_plan_signals(v)',
    'validate_plan_source_policy(v)',
    'print("canonical-plan-valid")',
  ].join(';')
  execFileSync('python', ['-c', code], { cwd: new URL('.', ROOT), input: JSON.stringify(plan), stdio: ['pipe', 'pipe', 'inherit'] })
}

async function globalSafetyState(client, ownSearchId = null, ownCanaryId = null) {
  const result = await client.query(
    `select
       (select count(*)::int from public.searches
          where ($1::uuid is null or id<>$1) and status in ('planning','pending','pending_user','processing','running')) other_active_jobs,
       (select count(*)::int from public.canary_runs
          where ($2::uuid is null or id<>$2) and status in ('created','running')) other_active_canaries,
       (select count(*)::int from public.search_cost_ledger where status='reserved') open_reservations,
       (select count(*)::int from public.search_cost_ledger
          where status='reserved' and reservation_expires_at < now()) stale_reservations,
       (select count(*)::int from public.search_publications where published_at > now() - interval '24 hours') publications_24h,
       (select count(*)::int from public.search_credit_charges where charged_at > now() - interval '24 hours') charges_24h`,
    [ownSearchId, ownCanaryId],
  )
  return result.rows[0]
}

async function prepare(client) {
  const spec = SPECS[vertical]
  if (!spec) throw new Error(`unknown vertical: ${vertical}`)
  const safety = await globalSafetyState(client)
  if (safety.other_active_jobs || safety.other_active_canaries || safety.open_reservations || safety.stale_reservations) {
    throw new Error(`unsafe pre-prepare state: ${JSON.stringify(safety)}`)
  }
  const searchId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  const canaryId = crypto.randomUUID()
  const plan = buildPlan(spec, searchId)
  validatePlanOffline(plan)
  const intent = {
    original_query: spec.query,
    query: spec.query,
    requested_leads: REQUESTED_COUNT,
    max_leads: REQUESTED_COUNT,
    lead_target: REQUESTED_COUNT,
    customer_visible: false,
    lifecycle_stage: 'v5_shadow',
    prepare_only: true,
    execution_authorized: false,
    source_adapter_shadow: true,
    canonical_plan_prevalidated: true,
    required_signals: spec.signals,
    signals: spec.signals.map((type) => ({ type, params: {} })),
    search_strategy: 'commercial_search',
    canonical_plan: plan,
    uqe_plan: {
      canonical_plan: plan,
      parse_source: 'prevalidated',
      search_strategy: 'commercial_search',
      required_signals: spec.signals,
      source_plan: [],
    },
  }

  await client.query('begin')
  try {
    await client.query(
      `insert into public.searches(id,category,location,status,results,zone,intent)
       values($1,$2,$3,'planning','[]'::jsonb,$4,$5::jsonb)`,
      [searchId, `Live shadow Source Adapter v5: ${vertical}`, spec.geographies[0], String(REQUESTED_COUNT), JSON.stringify(intent)],
    )
    await client.query(
      `insert into public.evaluation_runs(id,dataset_version,release_id,mode,status,configuration)
       values($1,$2,$3,'shadow_research','running',$4::jsonb)`,
      [runId, DATASET_VERSION, args.get('release-id') || '20260715_021048', JSON.stringify({
        vertical, query: spec.query, requested_count: REQUESTED_COUNT,
        hard_budget_eur: HARD_BUDGET_EUR, customer_visible: false,
        source_adapter_shadow: true, canonical_plan_prevalidated: true,
      })],
    )
    await client.query(
      `insert into public.canary_runs(id,evaluation_run_id,search_id,canary_type,exact_query,max_leads,
          hard_budget_eur,shadow_mode,customer_visible,worker_limit,status)
       values($1,$2,$3,$4,$5,$6,$7,true,false,1,'running')`,
      [canaryId, runId, searchId, `source_adapter_v5_${vertical}`, spec.query, REQUESTED_COUNT, HARD_BUDGET_EUR],
    )
    for (const sourceClass of spec.preferredSources) {
      await client.query(
        `insert into public.evaluation_source_events(
           evaluation_run_id,canary_run_id,search_id,vertical,source_id,event_type,
           extraction_method,cost_eur,selection_reason,metadata)
         values($1,$2,$3,$4,$5,'selected','source_adapter_v5',0,$6,$7::jsonb)`,
        [runId, canaryId, searchId, vertical, sourceClass,
          `Prevalidated source policy for: ${spec.signals.join(', ')}`,
          JSON.stringify({ query: spec.query, required_signals: spec.signals, paid_calls: 0 })],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  console.log(JSON.stringify({ action: 'prepared', vertical, search_id: searchId, canary_id: canaryId, run_id: runId, safety, plan }, null, 2))
}

async function authorize(client) {
  const searchId = requireUuid('search', args.get('search-id'))
  const canaryId = requireUuid('canary', args.get('canary-id'))
  const runId = requireUuid('run', args.get('run-id'))
  await client.query('begin')
  try {
    const state = await client.query(
      `select s.status search_status,s.intent,s.results,s.progress,
              c.status canary_status,c.search_id,c.evaluation_run_id,c.hard_budget_eur,c.customer_visible,c.worker_limit,
              e.status run_status,e.configuration
         from public.searches s
         join public.canary_runs c on c.id=$2 and c.search_id=s.id
         join public.evaluation_runs e on e.id=$3 and e.id=c.evaluation_run_id
        where s.id=$1 for update of s,c,e`,
      [searchId, canaryId, runId],
    )
    if (state.rowCount !== 1) throw new Error('controlled source-adapter relation mismatch')
    const row = state.rows[0]
    const intent = row.intent || {}
    const plan = intent?.uqe_plan?.canonical_plan || intent?.canonical_plan
    validatePlanOffline(plan)
    if (row.search_status !== 'planning' || row.canary_status !== 'running' || row.run_status !== 'running') {
      throw new Error(`invalid controlled state search=${row.search_status} canary=${row.canary_status} run=${row.run_status}`)
    }
    if (row.customer_visible !== false || row.worker_limit !== 1 || Number(row.hard_budget_eur) !== HARD_BUDGET_EUR) {
      throw new Error('canary isolation/budget invariant failed')
    }
    if (intent.lifecycle_stage !== 'v5_shadow' || intent.customer_visible !== false ||
        intent.prepare_only !== true || intent.execution_authorized !== false ||
        intent.source_adapter_shadow !== true || intent.canonical_plan_prevalidated !== true) {
      throw new Error('source-adapter authorization state invalid')
    }
    if (Number(plan?.budget_policy?.hard_cost_eur) !== HARD_BUDGET_EUR ||
        Number(plan?.budget_policy?.maximum_llm_evaluations) !== 0) {
      throw new Error('canonical hard budget/LLM invariant failed')
    }
    const safety = await globalSafetyState(client, searchId, canaryId)
    const gates = await client.query(
      `select
         (select count(*)::int from public.search_cost_ledger where search_id=$1 and operation_type='intent_compilation') compiler_calls,
         (select coalesce(sum(coalesce(actual_cost_eur,estimated_cost_eur)),0)::float from public.search_cost_ledger where search_id=$1) cost_eur,
         (select count(*)::int from public.search_candidates where search_id=$1) candidates,
         (select count(*)::int from public.search_publications where search_id=$1) publications,
         (select count(*)::int from public.search_credit_charges where search_id=$1) charges`,
      [searchId],
    )
    const gate = gates.rows[0]
    if (safety.other_active_jobs || safety.other_active_canaries || safety.open_reservations || safety.stale_reservations ||
        gate.compiler_calls !== 0 || Number(gate.cost_eur) !== 0 || gate.candidates || gate.publications || gate.charges) {
      throw new Error(`authorization gate failed: ${JSON.stringify({ safety, gate })}`)
    }
    await client.query(
      `update public.searches
          set status='pending',
              intent=jsonb_set(jsonb_set(intent,'{prepare_only}','false'::jsonb,true),
                               '{execution_authorized}','true'::jsonb,true),
              progress=jsonb_build_object('stage','authorized_source_adapter_shadow','found',0,'published',0,
                                           'execution_authorized_at',now()),
              updated_at=now()
        where id=$1`,
      [searchId],
    )
    await client.query(
      `update public.evaluation_runs set metrics=jsonb_build_object(
         'execution_authorized',true,'execution_authorized_at',now(),'pre_execution_safety',$2::jsonb)
       where id=$1`,
      [runId, JSON.stringify({ safety, gate })],
    )
    await client.query('commit')
    console.log(JSON.stringify({ action: 'authorized', search_id: searchId, canary_id: canaryId, run_id: runId, safety, gate }, null, 2))
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function quarantine(client) {
  const searchId = requireUuid('search', args.get('search-id'))
  const canaryId = requireUuid('canary', args.get('canary-id'))
  const runId = requireUuid('run', args.get('run-id'))
  const reason = String(args.get('reason') || 'SOURCE_ADAPTER_CANARY_FAILED').slice(0, 500)
  await client.query('begin')
  try {
    const state = await client.query(
      `select s.status search_status,c.status canary_status,e.status run_status
         from public.searches s
         join public.canary_runs c on c.id=$2 and c.search_id=s.id
         join public.evaluation_runs e on e.id=$3 and e.id=c.evaluation_run_id
        where s.id=$1 for update of s,c,e`,
      [searchId, canaryId, runId],
    )
    if (state.rowCount !== 1) throw new Error('controlled source-adapter relation mismatch')
    const gates = await client.query(
      `select
         (select coalesce(sum(coalesce(actual_cost_eur,estimated_cost_eur)),0)::float from public.search_cost_ledger where search_id=$1) cost_eur,
         (select count(*)::int from public.search_publications where search_id=$1) publications,
         (select count(*)::int from public.search_credit_charges where search_id=$1) charges`,
      [searchId],
    )
    const gate = gates.rows[0]
    if (Number(gate.cost_eur) > HARD_BUDGET_EUR || gate.publications || gate.charges) {
      throw new Error(`quarantine safety gate failed: ${JSON.stringify(gate)}`)
    }
    await client.query(
      `update public.canary_runs set status='quarantined',stop_reason=$2,completed_at=now() where id=$1`,
      [canaryId, reason],
    )
    await client.query(
      `update public.evaluation_runs
          set status='failed',metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
            'quarantined',true,'stop_reason',$2::text,'cost_eur',$3::numeric),completed_at=now()
        where id=$1`,
      [runId, reason, Number(gate.cost_eur)],
    )
    await client.query('commit')
    console.log(JSON.stringify({ action: 'quarantined', search_id: searchId, canary_id: canaryId, run_id: runId, reason, gate }, null, 2))
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

if (!loadMiraxDbPassword()) throw new Error('ECOSISTEMA_DB_PASSWORD required')
const client = await connectMiraxDb()
try {
  if (action === 'validate') {
    const selected = vertical ? [[vertical, SPECS[vertical]]] : Object.entries(SPECS)
    if (selected.some(([, spec]) => !spec)) throw new Error(`unknown vertical: ${vertical}`)
    for (const [, spec] of selected) validatePlanOffline(buildPlan(spec, crypto.randomUUID()))
    console.log(JSON.stringify({ action: 'validated', verticals: selected.map(([name]) => name), paid_calls: 0 }, null, 2))
  } else if (action === 'prepare') await prepare(client)
  else if (action === 'authorize') await authorize(client)
  else if (action === 'quarantine') await quarantine(client)
  else throw new Error('action must be validate, prepare, authorize or quarantine')
} finally {
  await client.end()
}
