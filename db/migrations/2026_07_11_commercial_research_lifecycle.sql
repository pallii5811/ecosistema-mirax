-- MIRAX canonical candidate/evidence/cost lifecycle.
-- Internal candidates never become user-visible until publish_candidate() passes all gates.

create table if not exists public.search_candidates (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_domain text,
  entity_name text not null,
  entity_type text not null default 'company',
  stage text not null default 'discovered' check (stage in (
    'discovered', 'entity_verified', 'evidence_pending', 'evidence_verified',
    'audit_pending', 'qualified', 'rejected', 'published'
  )),
  official_domain_verified boolean not null default false,
  target_fit_verified boolean not null default false,
  signal_verified boolean not null default false,
  evidence_policy_passed boolean not null default false,
  audit_completed boolean not null default false,
  buyer_offer_fit_score numeric(6,5) check (buyer_offer_fit_score between 0 and 1),
  rejection_code text,
  rejection_detail jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'rejected' or rejection_code is not null),
  check (stage not in ('qualified', 'published') or (
    official_domain_verified and target_fit_verified and signal_verified
    and evidence_policy_passed and audit_completed
  ))
);

create unique index if not exists search_candidates_search_domain_uq
  on public.search_candidates(search_id, lower(canonical_domain))
  where canonical_domain is not null and canonical_domain <> '';
create index if not exists search_candidates_search_stage_idx
  on public.search_candidates(search_id, stage, created_at);

create table if not exists public.search_evidence (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  candidate_id uuid not null references public.search_candidates(id) on delete cascade,
  signal_type text not null,
  fact_type text not null check (fact_type in ('observed_fact', 'derived_fact', 'commercial_inference', 'unknown')),
  source_url text not null check (source_url ~ '^https?://'),
  source_class text not null,
  evidence_excerpt text,
  observed_at timestamptz not null,
  confidence numeric(6,5) not null check (confidence between 0 and 1),
  is_primary_source boolean not null default false,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(candidate_id, signal_type, source_url, content_hash)
);

create index if not exists search_evidence_candidate_signal_idx
  on public.search_evidence(candidate_id, signal_type, observed_at desc);

create table if not exists public.search_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  candidate_id uuid references public.search_candidates(id) on delete set null,
  operation_type text not null,
  source_class text,
  provider text,
  model text,
  units numeric(18,6) not null default 1 check (units >= 0),
  estimated_cost_eur numeric(18,8) not null default 0 check (estimated_cost_eur >= 0),
  actual_cost_eur numeric(18,8) check (actual_cost_eur >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'failed')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(search_id, idempotency_key)
);

create index if not exists search_cost_ledger_search_idx
  on public.search_cost_ledger(search_id, status, created_at);

create table if not exists public.search_publications (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  candidate_id uuid not null references public.search_candidates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  published_payload jsonb not null,
  evidence_snapshot jsonb not null,
  published_at timestamptz not null default now(),
  unique(search_id, candidate_id)
);

alter table public.search_candidates enable row level security;
alter table public.search_evidence enable row level security;
alter table public.search_cost_ledger enable row level security;
alter table public.search_publications enable row level security;

drop policy if exists search_publications_owner_select on public.search_publications;
create policy search_publications_owner_select
  on public.search_publications for select
  to authenticated
  using (user_id = auth.uid());

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
  select * into c
  from public.search_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'CANDIDATE_NOT_FOUND';
  end if;
  if c.stage = 'rejected' then
    raise exception 'CANDIDATE_REJECTED';
  end if;
  if not (
    c.official_domain_verified and c.target_fit_verified and c.signal_verified
    and c.evidence_policy_passed and c.audit_completed
  ) then
    raise exception 'PUBLICATION_GATE_FAILED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'signal_type', e.signal_type,
    'fact_type', e.fact_type,
    'source_url', e.source_url,
    'source_class', e.source_class,
    'evidence_excerpt', e.evidence_excerpt,
    'observed_at', e.observed_at,
    'confidence', e.confidence,
    'is_primary_source', e.is_primary_source
  ) order by e.confidence desc), '[]'::jsonb)
  into evidence_payload
  from public.search_evidence e
  where e.candidate_id = c.id
    and e.fact_type in ('observed_fact', 'derived_fact')
    and e.source_url is not null;

  if jsonb_array_length(evidence_payload) = 0 then
    raise exception 'MISSING_PUBLISHABLE_EVIDENCE';
  end if;

  insert into public.search_publications(search_id, candidate_id, user_id, published_payload, evidence_snapshot)
  values (c.search_id, c.id, c.user_id, c.payload, evidence_payload)
  on conflict (search_id, candidate_id) do update
    set published_payload = excluded.published_payload,
        evidence_snapshot = excluded.evidence_snapshot,
        published_at = now()
  returning id into publication_id;

  update public.search_candidates
  set stage = 'published', updated_at = now()
  where id = c.id;

  return publication_id;
end;
$$;

revoke all on function public.publish_search_candidate(uuid) from public, anon, authenticated;
grant execute on function public.publish_search_candidate(uuid) to service_role;

revoke all on public.search_candidates, public.search_evidence, public.search_cost_ledger from anon, authenticated;
grant select on public.search_publications to authenticated;
grant all on public.search_candidates, public.search_evidence, public.search_cost_ledger, public.search_publications to service_role;

