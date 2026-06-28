-- ============================================================================
-- Blocco 3 — EDAT lite: event bus interno, monitor lead, alert operativi
-- ============================================================================

-- Event bus (consumer: /api/cron/process-events)
create table if not exists public.mirax_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'failed')),
  attempts int not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists mirax_events_pending_idx
  on public.mirax_events (created_at asc)
  where status = 'pending';

create index if not exists mirax_events_user_idx
  on public.mirax_events (user_id, created_at desc);

-- Lead monitor (utente chiede sorveglianza su un lead in searches.results)
create table if not exists public.lead_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  search_id uuid not null,
  lead_index int not null,
  lead_name text,
  lead_website text,
  lead_city text,
  lead_category text,
  last_snapshot jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, search_id, lead_index)
);

create index if not exists lead_monitors_user_idx on public.lead_monitors (user_id, created_at desc);
create index if not exists lead_monitors_search_idx on public.lead_monitors (search_id, lead_index);

-- Alert in-app (popolati dal consumer eventi)
create table if not exists public.lead_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists lead_alerts_user_unread_idx
  on public.lead_alerts (user_id, created_at desc)
  where is_read = false;

alter table public.mirax_events enable row level security;
alter table public.lead_monitors enable row level security;
alter table public.lead_alerts enable row level security;

drop policy if exists "mirax_events_own" on public.mirax_events;
create policy "mirax_events_own" on public.mirax_events
  for select using (auth.uid() = user_id);

drop policy if exists "mirax_events_service" on public.mirax_events;
create policy "mirax_events_service" on public.mirax_events
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "lead_monitors_own" on public.lead_monitors;
create policy "lead_monitors_own" on public.lead_monitors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "lead_monitors_service" on public.lead_monitors;
create policy "lead_monitors_service" on public.lead_monitors
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "lead_alerts_own" on public.lead_alerts;
create policy "lead_alerts_own" on public.lead_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "lead_alerts_service" on public.lead_alerts;
create policy "lead_alerts_service" on public.lead_alerts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
