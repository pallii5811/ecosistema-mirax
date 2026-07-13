#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const manifest = JSON.parse(fs.readFileSync('evaluation/gold-v1/manifest.json', 'utf8'))
const verticalConfig = {
  accountant: {
    query: 'PMI italiane con crescita, nuova apertura o complessità amministrativa e societaria recente',
    terms: ['nuova apertura','crescita','fatturato','dipendenti','registro','societ','appalto','assun'],
  },
  insurance_broker: {
    query: 'PMI operative con espansione, nuovi cantieri, flotta, appalti o assunzioni operative recenti',
    terms: ['cantiere','edil','logistic','flotta','appalto','assun','espansion','produzione'],
  },
  local_web_agency: {
    query: 'PMI locali con sito debole, tracking mancante o investimento pubblicitario verificabile',
    terms: ['seo','pixel','analytics','tag manager','sito','ecommerce','ads','marketing','mobile'],
  },
  software_house: {
    query: 'PMI con crescita, assunzioni digitali, processi manuali o trasformazione tecnologica',
    terms: ['software','digital','cloud','crm','erp','developer','tech','assun','automaz'],
  },
  hr_recruitment: {
    query: 'PMI con assunzioni recenti e ruoli difficili da coprire',
    terms: ['assun','hiring','lavora con noi','career','job','ricerca personale','dipendenti'],
  },
  solar_energy: {
    query: 'PMI energivore o con sedi produttive, capannoni ed espansioni compatibili con fotovoltaico',
    terms: ['produzione','industr','capann','energia','fotovolta','stabilimento','logistic','hotel'],
  },
  cybersecurity: {
    query: 'PMI digitalizzate con esposizione web, ecommerce, posta o compliance e protezioni migliorabili',
    terms: ['dmarc','spf','ssl','ecommerce','cloud','software','privacy','security','cyber'],
  },
  erp_crm: {
    query: 'PMI in crescita con vendite, più sedi, assunzioni o segnali di cambio gestionale/CRM',
    terms: ['crm','erp','vendite','commercial','assun','sedi','crescita','gestionale'],
  },
  workplace_safety: {
    query: 'PMI con personale operativo, cantieri, produzione, appalti o crescita dell’organico',
    terms: ['cantiere','edil','produzione','opera','magazz','appalto','assun','industr'],
  },
  industrial_water_treatment: {
    query: 'PMI manifatturiere con processi idrici, impianti, produzione o requisiti ambientali',
    terms: ['acqua','trattamento','chimic','alimentar','tessil','produzione','impianto','ambient','industr'],
  },
}

function domainOf(raw) {
  try {
    const url = new URL(/^https?:\/\//i.test(String(raw || '')) ? String(raw) : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch { return '' }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function compactCandidate(item) {
  const website = String(item.sito || item.website || item.url || '').trim()
  const name = String(item.azienda || item.nome || item.name || item.business_name || '').trim()
  const domain = domainOf(website)
  if (!name || !domain) return null
  if (/^(?:nike|ferrari|uniqlo|primark|amazon|google|microsoft|ikea|zara|h&m)\b/i.test(name)) return null
  return {
    name,
    website,
    domain,
    city: String(item.citta || item.city || item.localita || '').trim() || null,
    category: String(item.categoria || item.category || '').trim() || null,
    phone: String(item.telefono || item.phone || '').trim() || null,
    email: String(item.email || '').trim() || null,
    rating: Number(item.rating) || null,
    reviews_count: Number(item.reviews_count || item.reviews) || null,
    business_signals: Array.isArray(item.business_signals) ? item.business_signals.slice(0, 20) : [],
    technical_report: item.technical_report && typeof item.technical_report === 'object' ? item.technical_report : null,
    raw_subset: Object.fromEntries(
      Object.entries(item).filter(([key]) => [
        'meta_pixel','google_analytics','google_tag_manager','ssl','mobile_friendly','seo_disaster',
        'has_dmarc','has_spf','has_ecommerce','has_chatbot','audit','opportunita',
      ].includes(key)),
    ),
  }
}

function scoreCandidate(candidate, terms) {
  const text = JSON.stringify(candidate).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return terms.reduce((score, term) => score + (text.includes(term.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) ? 1 : 0), 0)
}

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const rows = await client.query(`
    select s.id search_id,s.category search_category,s.location search_location,s.created_at search_created_at,
      coalesce(s.intent->>'original_query',s.intent->>'query','') original_query,
      item.result_index,item.payload
    from public.searches s
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(s.results::jsonb)='array' then s.results::jsonb else '[]'::jsonb end
    ) with ordinality as item(payload,result_index)
    where s.status='completed'
    order by s.created_at,item.result_index
  `)
  const byDomain = new Map()
  for (const row of rows.rows) {
    const candidate = compactCandidate(row.payload)
    if (!candidate || byDomain.has(candidate.domain)) continue
    byDomain.set(candidate.domain, { candidate, provenance: {
      source_kind: 'legacy_completed_search', search_id: row.search_id,
      result_index: Number(row.result_index), search_category: row.search_category,
      search_location: row.search_location, original_query: row.original_query,
      search_created_at: row.search_created_at,
    } })
  }
  const pool = [...byDomain.values()]
  if (pool.length < 200) throw new Error(`candidate pool too small: ${pool.length}`)

  const used = new Set()
  const assignments = []
  for (const vertical of manifest.verticals) {
    const config = verticalConfig[vertical.id]
    if (!config) throw new Error(`missing vertical config: ${vertical.id}`)
    const ranked = pool
      .filter((row) => !used.has(row.candidate.domain))
      .map((row) => ({ ...row, selection_score: scoreCandidate(row.candidate, config.terms) }))
      .sort((a, b) => b.selection_score - a.selection_score || stableHash(`${vertical.id}:${a.candidate.domain}`).localeCompare(stableHash(`${vertical.id}:${b.candidate.domain}`)))
    const potential = ranked.slice(0, 10)
    potential.forEach((row) => used.add(row.candidate.domain))
    const controls = ranked
      .filter((row) => !used.has(row.candidate.domain))
      .sort((a, b) => a.selection_score - b.selection_score || stableHash(`control:${vertical.id}:${a.candidate.domain}`).localeCompare(stableHash(`control:${vertical.id}:${b.candidate.domain}`)))
      .slice(0, 10)
    controls.forEach((row) => used.add(row.candidate.domain))
    for (const [index, row] of [...potential, ...controls].entries()) {
      assignments.push({
        vertical: vertical.id,
        case_number: index + 1,
        query: config.query,
        candidate_snapshot: row.candidate,
        provenance: {
          ...row.provenance,
          selection_bucket: index < 10 ? 'potential_fit' : 'control',
          selection_score: row.selection_score,
          selection_is_not_ground_truth: true,
          human_ground_truth_required: true,
          populated_at: new Date().toISOString(),
        },
      })
    }
  }
  if (assignments.length !== 200 || used.size !== 200) throw new Error('expected 200 unique assignments')

  await client.query('begin')
  await client.query(`
    update public.evaluation_cases c set
      query=x.query,
      candidate_snapshot=x.candidate_snapshot,
      provenance=x.provenance,
      review_status='candidate_ready',
      updated_at=now()
    from jsonb_to_recordset($2::jsonb) as x(
      vertical text,case_number integer,query text,candidate_snapshot jsonb,provenance jsonb
    )
    where c.dataset_version=$1 and c.vertical=x.vertical and c.case_number=x.case_number
      and c.review_status in ('empty','candidate_ready')
  `, [manifest.dataset_version, JSON.stringify(assignments)])
  const validation = await client.query(`
    select count(*)::int total,
      count(*) filter (where review_status='candidate_ready')::int ready,
      count(distinct candidate_snapshot->>'domain')::int unique_domains,
      count(*) filter (where coalesce(candidate_snapshot->>'website','')<>'')::int with_website,
      count(*) filter (where provenance->>'selection_is_not_ground_truth'='true')::int no_ground_truth_leakage
    from public.evaluation_cases where dataset_version=$1
  `, [manifest.dataset_version])
  const result = validation.rows[0]
  if (Number(result.ready) !== 200 || Number(result.unique_domains) !== 200 || Number(result.with_website) !== 200 || Number(result.no_ground_truth_leakage) !== 200) {
    throw new Error(`gold population validation failed: ${JSON.stringify(result)}`)
  }
  await client.query('commit')
  console.log(JSON.stringify({ dataset_version: manifest.dataset_version, ...result, expected_labels_created: 0, human_judgments_created: 0 }, null, 2))
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
