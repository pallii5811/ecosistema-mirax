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
  created_at timestamptz default timezone('utc', now()) not null
);

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
