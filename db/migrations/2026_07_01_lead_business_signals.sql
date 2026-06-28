-- Business events signals per lead (Fase 1-A MIRAX)
create table if not exists public.lead_business_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  lead_website text not null,
  lead_name text,
  signal_type text not null check (signal_type in (
    'hiring', 'new_location', 'registry_change', 'funding_news',
    'site_stale', 'meta_ads_started', 'google_ads_started'
  )),
  title text not null,
  severity text not null check (severity in ('critical', 'high', 'medium')),
  confidence smallint not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]',
  source text not null,
  detected_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, lead_website, signal_type, title)
);

create index if not exists idx_lbs_user_website on public.lead_business_signals(user_id, lead_website);
create index if not exists idx_lbs_detected_at on public.lead_business_signals(detected_at desc);

alter table public.lead_business_signals enable row level security;

drop policy if exists "Users read own lead_business_signals" on public.lead_business_signals;
create policy "Users read own lead_business_signals"
  on public.lead_business_signals for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own lead_business_signals" on public.lead_business_signals;
create policy "Users insert own lead_business_signals"
  on public.lead_business_signals for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own lead_business_signals" on public.lead_business_signals;
create policy "Users update own lead_business_signals"
  on public.lead_business_signals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role full access lead_business_signals" on public.lead_business_signals;
create policy "Service role full access lead_business_signals"
  on public.lead_business_signals for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
