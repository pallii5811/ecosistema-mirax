-- GDPR / Registro Opposizioni compliance checks (Fase 1-B MIRAX)
create table if not exists public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'phone', 'whatsapp')),
  target text not null,
  check_type text not null check (check_type in ('registro_opposizioni', 'gdpr_basis_logged')),
  status text not null check (status in ('clear', 'blocked', 'unknown', 'manual_review')),
  raw_response jsonb,
  checked_at timestamptz not null default now()
);

create index if not exists idx_compliance_target on public.compliance_checks(user_id, target, check_type);
create index if not exists idx_compliance_checked_at on public.compliance_checks(checked_at desc);

alter table public.compliance_checks enable row level security;

drop policy if exists "Users read own compliance_checks" on public.compliance_checks;
create policy "Users read own compliance_checks"
  on public.compliance_checks for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own compliance_checks" on public.compliance_checks;
create policy "Users insert own compliance_checks"
  on public.compliance_checks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Service role full access compliance_checks" on public.compliance_checks;
create policy "Service role full access compliance_checks"
  on public.compliance_checks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
