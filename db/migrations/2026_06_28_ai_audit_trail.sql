-- ============================================================================
-- Migration: ai_audit_trail — AI Act transparency / decision audit log
-- Traccia motivazioni per outreach, score, pitch e insight (explainability).
-- ============================================================================

create table if not exists public.ai_audit_trail (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_type text not null check (decision_type in ('outreach', 'score', 'pitch', 'insight')),
  entity_ref text,
  rationale text not null,
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists ai_audit_trail_user_created_idx
  on public.ai_audit_trail(user_id, created_at desc);

create index if not exists ai_audit_trail_type_idx
  on public.ai_audit_trail(decision_type, created_at desc);

alter table public.ai_audit_trail enable row level security;

drop policy if exists "Users read own ai_audit_trail" on public.ai_audit_trail;
create policy "Users read own ai_audit_trail"
  on public.ai_audit_trail for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own ai_audit_trail" on public.ai_audit_trail;
create policy "Users insert own ai_audit_trail"
  on public.ai_audit_trail for insert
  with check (auth.uid() = user_id);

drop policy if exists "Service role full access ai_audit_trail" on public.ai_audit_trail;
create policy "Service role full access ai_audit_trail"
  on public.ai_audit_trail for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
