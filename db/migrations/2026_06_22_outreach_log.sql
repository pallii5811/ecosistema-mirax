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
