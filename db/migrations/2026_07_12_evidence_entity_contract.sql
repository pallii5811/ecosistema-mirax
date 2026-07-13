-- MIRAX positive entity resolution + auditable evidence contract.

alter table public.search_candidates
  add column if not exists legal_name text,
  add column if not exists entity_resolution_method text,
  add column if not exists entity_resolution_confidence numeric(6,5) check (entity_resolution_confidence between 0 and 1),
  add column if not exists positive_identity_signals jsonb not null default '[]'::jsonb,
  add column if not exists identity_source_url text,
  add column if not exists identity_resolved_at timestamptz,
  add column if not exists operating_company_probability numeric(6,5) check (operating_company_probability between 0 and 1),
  add column if not exists official_domain_confidence numeric(6,5) check (official_domain_confidence between 0 and 1),
  add column if not exists company_size_class text,
  add column if not exists local_presence jsonb not null default '{}'::jsonb,
  add column if not exists is_media boolean not null default false,
  add column if not exists is_directory boolean not null default false,
  add column if not exists is_university boolean not null default false,
  add column if not exists is_public_body boolean not null default false,
  add column if not exists is_global_brand boolean not null default false,
  add column if not exists is_source_publisher boolean not null default false,
  add column if not exists is_operating_buyer boolean not null default false;

alter table public.search_evidence
  add column if not exists claim_type text not null default 'buying_signal',
  add column if not exists claim_value text not null default '',
  add column if not exists source_publisher text not null default '',
  add column if not exists published_at timestamptz,
  add column if not exists retrieval_method text not null default 'http_fetch',
  add column if not exists verification_status text not null default 'single_source',
  add column if not exists contradiction_status text not null default 'none'
    check (contradiction_status in ('none', 'suspected', 'confirmed')),
  add column if not exists contradicts_evidence_ids uuid[] not null default '{}'::uuid[],
  add column if not exists contradiction_detail jsonb not null default '{}'::jsonb,
  add column if not exists fact_category text generated always as (upper(fact_type)) stored;

alter table public.search_evidence drop constraint if exists search_evidence_verification_status_check;
alter table public.search_evidence add constraint search_evidence_verification_status_check
  check (verification_status in ('single_source', 'primary_source_verified', 'corroborated'));

alter table public.search_candidates
  drop constraint if exists search_candidates_positive_identity_gate;
alter table public.search_candidates
  add constraint search_candidates_positive_identity_gate check (
    stage not in ('qualified', 'published') or (
      legal_name is not null and length(trim(legal_name)) >= 2
      and entity_resolution_method = 'positive_page_identity'
      and entity_resolution_confidence >= 0.70
      and jsonb_typeof(positive_identity_signals) = 'array'
      and jsonb_array_length(positive_identity_signals) >= 2
      and identity_source_url ~ '^https?://'
      and identity_resolved_at is not null
      and operating_company_probability >= 0.75
      and official_domain_confidence >= 0.70
      and is_operating_buyer
      and not is_media and not is_directory and not is_university and not is_public_body
      and not is_source_publisher and not is_global_brand
    )
  );

create or replace function public.publish_search_candidate(p_candidate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.search_candidates%rowtype;
  publication_id uuid;
  evidence_payload jsonb;
begin
  select * into c from public.search_candidates where id = p_candidate_id for update;
  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  if c.stage = 'rejected' then raise exception 'CANDIDATE_REJECTED'; end if;
  if not (
    c.official_domain_verified and c.target_fit_verified and c.signal_verified
    and c.evidence_policy_passed and c.audit_completed
    and c.legal_name is not null and length(trim(c.legal_name)) >= 2
    and c.entity_resolution_method = 'positive_page_identity'
    and c.entity_resolution_confidence >= 0.70
    and jsonb_array_length(c.positive_identity_signals) >= 2
    and c.identity_source_url ~ '^https?://'
    and c.identity_resolved_at is not null
    and c.operating_company_probability >= 0.75
    and c.official_domain_confidence >= 0.70
    and c.is_operating_buyer
    and not c.is_media and not c.is_directory and not c.is_university
    and not c.is_public_body and not c.is_source_publisher and not c.is_global_brand
  ) then
    raise exception 'PUBLICATION_GATE_FAILED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'claim_type', e.claim_type,
    'claim_value', e.claim_value,
    'signal_type', e.signal_type,
    'fact_type', e.fact_type,
    'fact_category', e.fact_category,
    'source_url', e.source_url,
    'source_class', e.source_class,
    'source_publisher', e.source_publisher,
    'published_at', e.published_at,
    'observed_at', e.observed_at,
    'retrieval_method', e.retrieval_method,
    'verification_status', e.verification_status,
    'contradiction_status', e.contradiction_status,
    'contradiction_detail', e.contradiction_detail,
    'evidence_excerpt', e.evidence_excerpt,
    'confidence', e.confidence,
    'is_primary_source', e.is_primary_source
  ) order by e.confidence desc), '[]'::jsonb)
  into evidence_payload
  from public.search_evidence e
  where e.candidate_id = c.id
    and e.fact_type in ('observed_fact', 'derived_fact')
    and e.verification_status in ('single_source', 'primary_source_verified', 'corroborated')
    and e.contradiction_status = 'none'
    and length(trim(e.claim_value)) > 0
    and length(trim(e.source_publisher)) > 0
    and e.source_url ~ '^https?://'
    and e.observed_at is not null;

  if jsonb_array_length(evidence_payload) = 0 then
    raise exception 'MISSING_PUBLISHABLE_EVIDENCE';
  end if;

  insert into public.search_publications(search_id, candidate_id, user_id, published_payload, evidence_snapshot)
  values (c.search_id, c.id, c.user_id, c.payload, evidence_payload)
  on conflict (search_id, candidate_id) do update set
    published_payload = excluded.published_payload,
    evidence_snapshot = excluded.evidence_snapshot,
    published_at = now()
  returning id into publication_id;

  update public.search_candidates set stage = 'published', updated_at = now() where id = c.id;
  return publication_id;
end;
$$;

revoke all on function public.publish_search_candidate(uuid) from public, anon, authenticated;
grant execute on function public.publish_search_candidate(uuid) to service_role;
