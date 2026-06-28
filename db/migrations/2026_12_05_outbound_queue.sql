-- Fase 9 — Outbound queue (HITL approval prima dell'invio)
create table if not exists public.outbound_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_name text,
  lead_website text,
  lead_email text,
  trigger_signal_type text not null,
  sequence_key text not null,
  intent_score int default 0,
  variants jsonb not null default '[]'::jsonb,
  selected_variant text default 'A',
  subject text not null,
  body text not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'scheduled', 'rejected', 'sent')),
  sender_email text,
  sender_name text,
  scheduled_at timestamptz,
  approved_at timestamptz,
  signal_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outbound_queue_user_status on public.outbound_queue(user_id, status, created_at desc);

alter table public.outbound_queue enable row level security;

drop policy if exists outbound_queue_own on public.outbound_queue;
create policy outbound_queue_own on public.outbound_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.outbound_queue is 'Coda outbound HITL — email generate da segnali, approvazione umana obbligatoria';
