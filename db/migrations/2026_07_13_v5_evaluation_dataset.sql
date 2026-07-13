alter table public.evaluation_cases
  add column if not exists cohort text not null default 'legacy_baseline'
    check (cohort in ('legacy_baseline', 'v5_output', 'adversarial')),
  add column if not exists origin_release_id text,
  add column if not exists source_run_id uuid references public.evaluation_runs(id) on delete set null;

update public.evaluation_cases
set cohort='legacy_baseline'
where dataset_version='mirax-gold-v1' and cohort is distinct from 'legacy_baseline';

create table if not exists public.evaluation_source_events (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references public.evaluation_runs(id) on delete cascade,
  canary_run_id uuid references public.canary_runs(id) on delete cascade,
  search_id uuid references public.searches(id) on delete set null,
  vertical text not null,
  source_id text not null,
  source_url text,
  publisher text,
  event_type text not null check (event_type in (
    'selected','queried','candidate_produced','signal_confirmed','candidate_rejected','candidate_publishable'
  )),
  candidate_ref text,
  signal_type text,
  observation_date timestamptz,
  extraction_method text,
  cost_eur numeric(18,8) not null default 0 check (cost_eur >= 0),
  selection_reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists evaluation_source_events_run_idx
  on public.evaluation_source_events(evaluation_run_id,vertical,source_id,event_type);
create index if not exists evaluation_source_events_search_idx
  on public.evaluation_source_events(search_id);

alter table public.evaluation_source_events enable row level security;
revoke all on public.evaluation_source_events from public, anon, authenticated;
grant all on public.evaluation_source_events to service_role;
