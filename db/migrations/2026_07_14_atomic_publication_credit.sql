-- Make the customer-visible publication and its credit charge one atomic unit.
-- The candidate row is the serialization point: concurrent/retried deliveries
-- either return the already charged publication or create+charge it exactly once.

create or replace function public.publish_search_candidate(p_candidate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.search_candidates%rowtype;
  v_publication_id uuid;
  v_existing_charge uuid;
  v_credits integer;
  v_evidence jsonb;
  v_charge_id uuid;
begin
  select * into c
  from public.search_candidates
  where id = p_candidate_id
  for update;

  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  if c.user_id is null then raise exception 'CUSTOMER_OWNER_REQUIRED'; end if;

  select p.id, ch.id into v_publication_id, v_existing_charge
  from public.search_publications p
  left join public.search_credit_charges ch
    on ch.publication_id = p.id and ch.user_id = c.user_id
  where p.search_id = c.search_id and p.candidate_id = c.id;

  -- A retry after the original transaction committed is a no-op.
  if v_publication_id is not null and v_existing_charge is not null then
    return v_publication_id;
  end if;

  if c.stage = 'rejected' then raise exception 'CANDIDATE_REJECTED'; end if;
  if not (
    c.official_domain_verified and c.target_fit_verified and c.signal_verified
    and c.evidence_policy_passed and c.audit_completed
    and c.legal_name is not null and length(trim(c.legal_name)) >= 2
    and c.entity_resolution_method = 'positive_page_identity'
    and c.entity_resolution_confidence >= 0.70
    and jsonb_typeof(c.positive_identity_signals) = 'array'
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

  select credits into v_credits
  from public.profiles
  where id = c.user_id
  for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_credits < 1 then raise exception 'INSUFFICIENT_CREDITS'; end if;

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
  into v_evidence
  from public.search_evidence e
  where e.candidate_id = c.id
    and e.fact_type in ('observed_fact', 'derived_fact')
    and e.verification_status in ('primary_source_verified', 'corroborated')
    and e.contradiction_status = 'none'
    and length(trim(e.claim_value)) > 0
    and length(trim(e.source_publisher)) > 0
    and e.source_url ~ '^https?://'
    and e.observed_at is not null;

  if jsonb_array_length(v_evidence) = 0 then
    raise exception 'MISSING_PUBLISHABLE_EVIDENCE';
  end if;

  if v_publication_id is null then
    insert into public.search_publications(
      search_id, candidate_id, user_id, published_payload, evidence_snapshot
    ) values (c.search_id, c.id, c.user_id, c.payload, v_evidence)
    on conflict (search_id, candidate_id) do nothing
    returning id into v_publication_id;

    if v_publication_id is null then
      select id into v_publication_id
      from public.search_publications
      where search_id = c.search_id and candidate_id = c.id;
    end if;
  end if;

  insert into public.search_credit_charges(
    search_id, candidate_id, publication_id, user_id, credits, status
  ) values (c.search_id, c.id, v_publication_id, c.user_id, 1, 'charged')
  on conflict do nothing
  returning id into v_charge_id;

  if v_charge_id is null then
    raise exception 'PUBLICATION_CHARGE_CONFLICT';
  end if;

  update public.profiles set credits = credits - 1 where id = c.user_id;
  update public.search_candidates
    set stage = 'published', updated_at = now()
    where id = c.id;

  return v_publication_id;
end;
$$;

revoke all on function public.publish_search_candidate(uuid) from public, anon, authenticated;
grant execute on function public.publish_search_candidate(uuid) to service_role;
