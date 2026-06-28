-- Fase 10 — Competitive Intelligence: competitor tracking + alerts
create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name varchar(255) not null,
  website varchar(255),
  city text,
  category text,
  tracked_signals text[] not null default '{hiring,tender_won}'::text[],
  digital_maturity int not null default 0 check (digital_maturity >= 0 and digital_maturity <= 100),
  growth_rate int not null default 0 check (growth_rate >= 0 and growth_rate <= 100),
  intent_score int not null default 0 check (intent_score >= 0 and intent_score <= 100),
  estimated_revenue numeric,
  signal_snapshot jsonb not null default '[]'::jsonb,
  last_signal_type text,
  last_signal_strength int default 0,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_competitors_user on public.competitors(user_id, updated_at desc);

alter table public.competitors enable row level security;

drop policy if exists competitors_own on public.competitors;
create policy competitors_own on public.competitors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.competitor_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  signal_type text not null,
  title text not null,
  body text,
  strength int not null default 0,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_competitor_alerts_user on public.competitor_alerts(user_id, created_at desc);
create index if not exists idx_competitor_alerts_unread on public.competitor_alerts(user_id) where read_at is null;

alter table public.competitor_alerts enable row level security;

drop policy if exists competitor_alerts_own on public.competitor_alerts;
create policy competitor_alerts_own on public.competitor_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.competitors is 'Competitor tracciati — waterfall segnali MIRAX';
comment on table public.competitor_alerts is 'Alert quando un competitor emette segnale forte';
