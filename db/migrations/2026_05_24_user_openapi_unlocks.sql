create table if not exists public.user_openapi_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  piva text not null,
  unlock_type text not null check (unlock_type in ('company', 'owner')),
  credits_spent integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, piva, unlock_type)
);

create index if not exists idx_user_openapi_unlocks_user on public.user_openapi_unlocks(user_id, created_at desc);
create index if not exists idx_user_openapi_unlocks_piva on public.user_openapi_unlocks(piva);

alter table public.user_openapi_unlocks enable row level security;

drop policy if exists "Users can read their own openapi unlocks" on public.user_openapi_unlocks;
create policy "Users can read their own openapi unlocks"
  on public.user_openapi_unlocks for select
  using (auth.uid() = user_id);

drop policy if exists "Service role full access user_openapi_unlocks" on public.user_openapi_unlocks;
create policy "Service role full access user_openapi_unlocks"
  on public.user_openapi_unlocks for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
