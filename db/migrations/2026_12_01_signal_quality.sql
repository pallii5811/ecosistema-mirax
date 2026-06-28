-- Fase 5.4 — Signal quality scoring columns
alter table public.lead_business_signals drop constraint if exists lead_business_signals_signal_type_check;

alter table public.lead_business_signals add constraint lead_business_signals_signal_type_check
  check (signal_type in (
    'hiring', 'new_location', 'registry_change', 'funding_news', 'funding_received',
    'site_stale', 'meta_ads_started', 'google_ads_started',
    'sector_investment', 'tender_won', 'crm_detected', 'crm_change',
    'executive_change', 'website_changed', 'partnership', 'expansion', 'price_change', 'acquisition'
  ));

alter table public.lead_business_signals
  add column if not exists freshness_hours int default 0,
  add column if not exists source_tier varchar(20) default 'aggregator'
    check (source_tier in ('official', 'aggregator', 'inferred')),
  add column if not exists verification_status varchar(20) default 'pending'
    check (verification_status in ('verified', 'pending', 'disputed'));

-- signal_strength: computed on read in app layer (Postgres generated cols need immutable expr)
create index if not exists idx_lbs_signal_strength on public.lead_business_signals(confidence desc, detected_at desc);

-- Website snapshots for diff engine (Fase 5.3 / 8.2)
create table if not exists public.website_snapshots (
  id uuid primary key default gen_random_uuid(),
  lead_website text not null,
  html_hash text not null,
  text_sample text,
  captured_at timestamptz not null default now(),
  unique (lead_website, html_hash)
);

create index if not exists idx_website_snapshots_url on public.website_snapshots(lead_website, captured_at desc);

alter table public.website_snapshots enable row level security;

drop policy if exists "Service role full access website_snapshots" on public.website_snapshots;
create policy "Service role full access website_snapshots"
  on public.website_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
