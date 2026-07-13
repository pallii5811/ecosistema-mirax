#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const tables = ['searches', 'search_candidates', 'search_evidence', 'search_publications', 'universe_entities', 'universe_observations']
  const counts = {}
  for (const table of tables) {
    const exists = await client.query('select to_regclass($1) as name', [`public.${table}`])
    if (!exists.rows[0]?.name) {
      counts[table] = { exists: false, count: 0 }
      continue
    }
    const result = await client.query(`select count(*)::int count from public.${table}`)
    counts[table] = { exists: true, count: Number(result.rows[0].count) }
  }

  const searchPool = await client.query(`
    select
      count(*)::int searches,
      count(*) filter (where jsonb_typeof(results::jsonb)='array' and jsonb_array_length(results::jsonb)>0)::int with_results,
      coalesce(sum(case when jsonb_typeof(results::jsonb)='array' then jsonb_array_length(results::jsonb) else 0 end),0)::int raw_result_rows
    from public.searches
    where status='completed'
  `)
  const candidateColumns = await client.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='search_candidates'
    order by ordinal_position
  `)
  const evidenceColumns = await client.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='search_evidence'
    order by ordinal_position
  `)
  const evaluation = await client.query(`
    select vertical, review_status, count(*)::int count
    from public.evaluation_cases where dataset_version='mirax-gold-v1'
    group by vertical,review_status order by vertical,review_status
  `)
  const reusableCandidates = await client.query(`
    select count(*)::int count
    from public.search_candidates c
    where coalesce(c.canonical_domain,'') <> ''
      and c.entity_resolution_confidence >= 0.7
      and exists (
        select 1 from public.search_evidence e
        where e.candidate_id=c.id
          and e.source_url is not null
          and e.observed_at is not null
      )
  `).catch((error) => ({ rows: [{ count: 0 }], error: error.message }))
  const legacyQuality = await client.query(`
    with rows as (
      select item
      from public.searches s
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(s.results::jsonb)='array' then s.results::jsonb else '[]'::jsonb end
      ) item
      where s.status='completed'
    ) select
      count(*)::int total,
      count(*) filter (where coalesce(item->>'sito',item->>'website',item->>'url','') <> '')::int with_website,
      count(*) filter (where coalesce(item->>'azienda',item->>'nome',item->>'name','') <> '')::int with_name,
      count(*) filter (where jsonb_typeof(item->'business_signals')='array' and jsonb_array_length(item->'business_signals')>0)::int with_business_signals,
      count(*) filter (where coalesce(item->>'email','') <> '' or coalesce(item->>'telefono',item->>'phone','') <> '')::int with_public_contact,
      count(*) filter (where coalesce(item->>'audit_status','') <> '')::int with_audit_status
    from rows
  `)
  const universeColumns = await client.query(`
    select table_name,column_name from information_schema.columns
    where table_schema='public' and table_name in ('universe_entities','universe_observations')
    order by table_name,ordinal_position
  `)
  const observationAttributes = await client.query(`
    select attribute,count(*)::int count
    from public.universe_observations
    group by attribute order by count(*) desc limit 30
  `)
  const entityIdentity = await client.query(`
    select
      count(*) filter (where canonical_id ~ '^[a-z0-9.-]+\\.[a-z]{2,}$')::int domain_canonical_ids,
      count(*) filter (where metadata ? 'website' or metadata ? 'domain' or metadata ? 'sito')::int metadata_with_domain
    from public.universe_entities where merged_into_id is null
  `)

  console.log(JSON.stringify({
    counts,
    completed_search_pool: searchPool.rows[0],
    legacy_result_quality: legacyQuality.rows[0],
    reusable_lifecycle_candidates: Number(reusableCandidates.rows[0]?.count || 0),
    reusable_query_error: reusableCandidates.error || null,
    search_candidate_columns: candidateColumns.rows.map((row) => row.column_name),
    search_evidence_columns: evidenceColumns.rows.map((row) => row.column_name),
    universe_columns: universeColumns.rows,
    universe_identity: entityIdentity.rows[0],
    observation_attributes: observationAttributes.rows,
    evaluation_status: evaluation.rows,
  }, null, 2))
} finally {
  await client.end()
}
