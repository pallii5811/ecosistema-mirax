-- === db/bootstrap/generated_schema.sql ===
-- Auto-generated from production PostgREST OpenAPI. Review before apply.
-- Run on EMPTY Supabase dev project, then db/migrations/*.sql
create extension if not exists "pgcrypto";

create table if not exists public.lead_pipeline (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  lead_website text,
  lead_name text not null,
  lead_phone text,
  lead_email text,
  lead_city text,
  lead_category text,
  lead_score integer default 0,
  stage text default 'nuovo' not null,
  deal_value numeric default 0,
  notes text,
  next_action text,
  next_action_date timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.lists (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz default now() not null,
  environment_id uuid
);

create table if not exists public.lead_interactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  lead_website text not null,
  lead_nome text,
  action text not null,
  score_at_time integer,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.environments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  name text not null,
  description text,
  icon text default 'folder',
  color text default '#8B5CF6',
  lead_ids uuid[],
  search_ids uuid[],
  filters jsonb,
  stats jsonb,
  is_auto_update boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.scheduled_emails (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  run_id uuid not null,
  step_index integer not null,
  subject text not null,
  body text not null,
  recipient_email text not null,
  sender_email text not null,
  sender_name text,
  scheduled_at timestamptz not null,
  status text default 'pending' not null,
  resend_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz default now() not null
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  name text,
  website text,
  email text,
  phone text,
  city text,
  category text,
  score integer,
  raw jsonb,
  created_at timestamptz default now() not null
);

create table if not exists public.outreach_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  lead_id uuid,
  lead_website text,
  lead_name text,
  channel text not null,
  message text,
  rationale text,
  status text default 'sent' not null,
  mode text default 'sell_service' not null,
  created_at timestamptz default now() not null
);

create table if not exists public.profiles (
  id uuid primary key,
  email text,
  credits integer default 10,
  plan_type text default 'free',
  full_name text default '',
  company text default '',
  stripe_customer_id text,
  stripe_subscription_id text,
  paypal_order_id text
);

create table if not exists public.user_integrations (
  user_id uuid primary key,
  webhook_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.list_leads (
  list_id uuid,
  lead_id uuid,
  created_at timestamptz default now() not null,
  primary key (list_id, lead_id)
);

create table if not exists public.saved_leads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  azienda text,
  telefono text,
  email text,
  citta text,
  tech_stack jsonb,
  created_at timestamptz default now()
);

create table if not exists public.sequence_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  sequence_id uuid,
  sequence_name text not null,
  recipient_email text not null,
  recipient_name text,
  sender_email text not null,
  sender_name text,
  status text default 'active' not null,
  steps_total integer default 0 not null,
  steps_sent integer default 0 not null,
  created_at timestamptz default now() not null,
  completed_at timestamptz
);

create table if not exists public.user_scoring_models (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  weight_no_pixel numeric default 25,
  weight_no_gtm numeric default 15,
  weight_no_ssl numeric default 10,
  weight_has_email numeric default 20,
  weight_seo_errors numeric default 15,
  weight_slow_speed numeric default 10,
  weight_no_google_ads numeric default 5,
  total_conversions integer default 0,
  total_rejections integer default 0,
  last_trained_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.sequences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  company_name text,
  website text,
  service text,
  sender_name text,
  sender_company text,
  tone text,
  steps jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.searches (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  category text not null,
  location text not null,
  status text default 'pending',
  results jsonb,
  intent jsonb,
  created_at timestamptz default timezone('utc', now()) not null
);

alter table public.searches add column if not exists worker_id text;
alter table public.searches add column if not exists heartbeat_at timestamptz;
alter table public.searches add column if not exists lease_expires_at timestamptz;
alter table public.searches add column if not exists attempt_count integer not null default 0;
alter table public.searches add column if not exists progress jsonb not null default '{}'::jsonb;
alter table public.searches add column if not exists updated_at timestamptz not null default now();
create index if not exists searches_processing_lease_idx
  on public.searches (lease_expires_at)
  where status = 'processing';
create or replace function public.searches_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists tr_searches_touch_updated_at on public.searches;
create trigger tr_searches_touch_updated_at
  before update on public.searches
  for each row execute function public.searches_touch_updated_at();

create table if not exists public.lead_enrichments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid,
  lead_website text not null,
  linkedin_url text,
  instagram_url text,
  facebook_url text,
  partita_iva text,
  anno_fondazione text,
  dipendenti_stimati text,
  extra_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- profiles.id should match auth.users (create via trigger or manual signup)
alter table public.profiles enable row level security;
alter table public.searches enable row level security;
alter table public.leads enable row level security;
alter table public.lists enable row level security;
alter table public.lead_pipeline enable row level security;
alter table public.environments enable row level security;


-- === db/bootstrap/rls_dev.sql ===
-- RLS base per ambiente DEV (replica semplificata produzione)
-- Service role bypassa RLS automaticamente.

do $$ begin
  create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "searches_own" on public.searches for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "leads_own" on public.leads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "lists_own" on public.lists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "environments_own" on public.environments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "lead_pipeline_own" on public.lead_pipeline for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "saved_leads_own" on public.saved_leads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sequences_own" on public.sequences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "sequence_runs_own" on public.sequence_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "user_integrations_own" on public.user_integrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "user_scoring_models_own" on public.user_scoring_models for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "lead_enrichments_own" on public.lead_enrichments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "lead_interactions_own" on public.lead_interactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;


-- === db/migrations/2026_04_24_lists_environment_link.sql ===
-- ============================================================================
-- Migration: link lists to environments (optional 1:N — one environment holds many lists)
-- Run this on your Supabase SQL editor.
-- ============================================================================

-- 1) Add environment_id to lists (nullable — a list can live without an environment).
alter table public.lists
  add column if not exists environment_id uuid references public.environments(id) on delete set null;

create index if not exists lists_environment_id_idx on public.lists(environment_id);

-- 2) Helpful index for the "my lists" page ordering.
create index if not exists lists_user_created_idx on public.lists(user_id, created_at desc);

-- 3) Helpful index for list_leads join.
create index if not exists list_leads_list_id_idx on public.list_leads(list_id);


-- === db/migrations/2026_05_24_company_lookup_cache.sql ===
-- Cache layer for OpenAPI.it certified company data.
-- Server-side only: used to avoid duplicate paid OpenAPI calls for the same P.IVA.

create table if not exists public.company_lookup_cache (
  piva text not null,
  source text not null,
  ragione_sociale text,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (piva, source)
);

create index if not exists idx_company_lookup_cache_source on public.company_lookup_cache(source);
create index if not exists idx_company_lookup_cache_expires on public.company_lookup_cache(expires_at);

alter table public.company_lookup_cache enable row level security;

drop policy if exists "Service role full access company_lookup_cache" on public.company_lookup_cache;
create policy "Service role full access company_lookup_cache"
  on public.company_lookup_cache for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.prune_company_lookup_cache()
returns integer as $$
declare
  deleted integer;
begin
  delete from public.company_lookup_cache where expires_at < now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$ language plpgsql security definer;


-- === db/migrations/2026_05_24_user_openapi_unlocks.sql ===
create table if not exists public.user_openapi_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  piva text not null,
  unlock_type text not null check (unlock_type in ('company', 'owner')),
  credits_spent integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, piva, unlock_type)
);

create index if not exists idx_user_openapi_unlocks_user on public.user_openapi_unlocks(user_id, created_at desc);
create index if not exists idx_user_openapi_unlocks_piva on public.user_openapi_unlocks(piva);

alter table public.user_openapi_unlocks enable row level security;

drop policy if exists "Users can read their own openapi unlocks" on public.user_openapi_unlocks;
create policy "Users can read their own openapi unlocks"
  on public.user_openapi_unlocks for select
  using (auth.uid() = user_id);

drop policy if exists "Service role full access user_openapi_unlocks" on public.user_openapi_unlocks;
create policy "Service role full access user_openapi_unlocks"
  on public.user_openapi_unlocks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- === db/migrations/2026_06_22_outreach_log.sql ===
-- ============================================================================
-- Migration: outreach_log — audit trail of every outreach action (AI-native governance)
-- Tracks each contact attempt per lead/channel so the dashboard can show status,
-- enforce daily guardrails (anti-ban) and provide monitoring/auditing.
-- Run this on your Supabase SQL editor.
-- ============================================================================

create table if not exists public.outreach_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  lead_website text,
  lead_name text,
  channel text not null check (channel in ('whatsapp', 'email', 'telegram', 'linkedin', 'call', 'other')),
  message text,
  -- Explainability: short reasoning describing WHY the AI chose this message/angle (AI Act trasparenza).
  rationale text,
  -- Lifecycle: 'sent' = contact fired; the rest are operator-recorded outcomes (closed-loop funnel).
  status text not null default 'sent' check (status in ('queued', 'sent', 'replied', 'interested', 'not_interested', 'no_answer', 'skipped', 'failed')),
  mode text not null default 'sell_service' check (mode in ('sell_service', 'mirax_promo')),
  created_at timestamptz not null default now()
);

-- Backfill column if the table already existed without it.
alter table public.outreach_log add column if not exists rationale text;

-- Idempotently widen the status check constraint to include outcome states (closed-loop funnel).
alter table public.outreach_log drop constraint if exists outreach_log_status_check;
alter table public.outreach_log
  add constraint outreach_log_status_check
  check (status in ('queued', 'sent', 'replied', 'interested', 'not_interested', 'no_answer', 'skipped', 'failed'));

create index if not exists outreach_log_user_idx on public.outreach_log(user_id, created_at desc);
create index if not exists outreach_log_user_website_idx on public.outreach_log(user_id, lead_website);
create index if not exists outreach_log_lead_idx on public.outreach_log(lead_id);

alter table public.outreach_log enable row level security;

drop policy if exists "Users manage their own outreach_log" on public.outreach_log;
create policy "Users manage their own outreach_log"
  on public.outreach_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role full access outreach_log" on public.outreach_log;
create policy "Service role full access outreach_log"
  on public.outreach_log for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- === db/migrations/2026_06_23_searches_zone.sql ===
-- Optional: stores requested max lead cap for worker scrape depth.
-- Run in Supabase SQL editor before enabling zone in trigger-scrape.
alter table public.searches add column if not exists zone text;
