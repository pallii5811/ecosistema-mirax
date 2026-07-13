-- Evaluation-only records. They are never joined into customer search results.

create table if not exists public.evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null,
  vertical text not null,
  case_number integer not null,
  seller_profile jsonb not null,
  query text not null,
  candidate_snapshot jsonb,
  provenance jsonb not null default '{}'::jsonb,
  review_status text not null default 'empty'
    check (review_status in ('empty', 'candidate_ready', 'labeled', 'adjudicated', 'quarantined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(dataset_version, vertical, case_number)
);

create table if not exists public.evaluation_expected_labels (
  case_id uuid primary key references public.evaluation_cases(id) on delete cascade,
  expected_label text not null check (expected_label in ('positive', 'negative')),
  reason text not null,
  official_domain text not null,
  company_size_class text not null,
  signal_date timestamptz not null,
  expected_source_policy jsonb not null,
  buyer_fit_min numeric(6,5) not null check (buyer_fit_min between 0 and 1),
  buyer_fit_max numeric(6,5) not null check (buyer_fit_max between 0 and 1),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (buyer_fit_min <= buyer_fit_max)
);

create table if not exists public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null,
  release_id text not null,
  mode text not null check (mode in ('offline', 'intent_canary', 'shadow_research', 'shadow_audit', 'transactional_publication')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'aborted')),
  configuration jsonb not null,
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.evaluation_judgments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.evaluation_cases(id) on delete cascade,
  run_id uuid references public.evaluation_runs(id) on delete cascade,
  judge_id uuid not null references auth.users(id),
  label text not null check (label in ('positive', 'negative', 'uncertain')),
  buyer_fit boolean,
  official_domain_correct boolean,
  entity_class_correct boolean,
  evidence_supports_claim boolean,
  signal_fresh boolean,
  contact_extraction_status text check (contact_extraction_status in ('available_extracted', 'available_missed', 'not_public', 'not_checked')),
  top_tier boolean,
  notes text,
  is_human boolean not null default true,
  supersedes_id uuid references public.evaluation_judgments(id),
  created_at timestamptz not null default now(),
  unique(case_id, run_id, judge_id)
);

create table if not exists public.canary_runs (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid references public.evaluation_runs(id) on delete set null,
  search_id uuid references public.searches(id) on delete set null,
  canary_type text not null,
  exact_query text not null,
  max_leads integer not null check (max_leads between 1 and 50),
  hard_budget_eur numeric(18,8) not null check (hard_budget_eur > 0),
  shadow_mode boolean not null default true,
  customer_visible boolean not null default false check (not customer_visible),
  worker_limit integer not null default 1 check (worker_limit = 1),
  status text not null default 'created' check (status in ('created', 'running', 'completed', 'failed', 'aborted', 'quarantined')),
  stop_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.evaluation_cases enable row level security;
alter table public.evaluation_expected_labels enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.evaluation_judgments enable row level security;
alter table public.canary_runs enable row level security;

revoke all on public.evaluation_cases, public.evaluation_expected_labels, public.evaluation_runs,
  public.evaluation_judgments, public.canary_runs from public, anon, authenticated;
grant all on public.evaluation_cases, public.evaluation_expected_labels, public.evaluation_runs,
  public.evaluation_judgments, public.canary_runs to service_role;

create or replace function public.evaluation_metrics(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (j.case_id) j.*
    from public.evaluation_judgments j
    where j.run_id = p_run_id and j.is_human
    order by j.case_id, j.created_at desc
  ), totals as (
    select
      count(*)::numeric judged,
      count(*) filter (where label = 'positive')::numeric accepted,
      count(*) filter (where label = 'positive' and buyer_fit and official_domain_correct
        and entity_class_correct and evidence_supports_claim and signal_fresh)::numeric true_positive,
      count(*) filter (where top_tier)::numeric top_tier_count,
      count(*) filter (where top_tier and label = 'positive' and buyer_fit and official_domain_correct
        and evidence_supports_claim)::numeric top_tier_true,
      count(*) filter (where evidence_supports_claim)::numeric evidence_ok,
      count(*) filter (where official_domain_correct)::numeric domain_ok,
      count(*) filter (where signal_fresh)::numeric date_ok,
      count(*) filter (where contact_extraction_status in ('available_extracted','available_missed'))::numeric contact_available,
      count(*) filter (where contact_extraction_status = 'available_extracted')::numeric contact_extracted
    from latest
  ) select jsonb_build_object(
    'human_judgments', judged,
    'published_precision', case when accepted > 0 then true_positive / accepted else null end,
    'top_tier_precision', case when top_tier_count > 0 then top_tier_true / top_tier_count else null end,
    'evidence_coverage', case when judged > 0 then evidence_ok / judged else null end,
    'official_domain_coverage', case when judged > 0 then domain_ok / judged else null end,
    'date_coverage', case when judged > 0 then date_ok / judged else null end,
    'public_contact_coverage', case when contact_available > 0 then contact_extracted / contact_available else null end,
    'contact_denominator', contact_available
  ) from totals;
$$;

revoke all on function public.evaluation_metrics(uuid) from public, anon, authenticated;
grant execute on function public.evaluation_metrics(uuid) to service_role;
