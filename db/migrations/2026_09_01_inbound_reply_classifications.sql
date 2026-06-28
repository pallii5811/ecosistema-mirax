-- Fase 3-A — AI SDR: classificazione risposte inbound (suggest-only, HITL)
create table if not exists public.inbound_reply_classifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outreach_log_id uuid references public.outreach_log(id) on delete set null,
  lead_name text,
  lead_website text,
  reply_snippet text not null,
  intent text not null check (intent in ('interested', 'not_now', 'not_interested', 'wrong_person', 'unsubscribe', 'unknown')),
  suggested_action text not null,
  follow_up_at timestamptz,
  confidence smallint check (confidence between 0 and 100),
  model text,
  rationale text,
  user_decision text check (user_decision in ('accepted', 'modified', 'ignored')),
  created_at timestamptz not null default now()
);

create index if not exists idx_irc_user_created on public.inbound_reply_classifications(user_id, created_at desc);
create index if not exists idx_irc_outreach_log on public.inbound_reply_classifications(outreach_log_id);

alter table public.inbound_reply_classifications enable row level security;

drop policy if exists "Users read own inbound_reply_classifications" on public.inbound_reply_classifications;
create policy "Users read own inbound_reply_classifications"
  on public.inbound_reply_classifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own inbound_reply_classifications" on public.inbound_reply_classifications;
create policy "Users insert own inbound_reply_classifications"
  on public.inbound_reply_classifications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own inbound_reply_classifications" on public.inbound_reply_classifications;
create policy "Users update own inbound_reply_classifications"
  on public.inbound_reply_classifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role full access inbound_reply_classifications" on public.inbound_reply_classifications;
create policy "Service role full access inbound_reply_classifications"
  on public.inbound_reply_classifications for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
