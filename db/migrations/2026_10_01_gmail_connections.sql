-- Fase 4-D — Gmail read-only per inbox seamless (OAuth tokens server-side)
create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default array['https://www.googleapis.com/auth/gmail.readonly'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_gmail_connections_user on public.gmail_connections(user_id);

alter table public.gmail_connections enable row level security;

drop policy if exists "Users read own gmail_connections" on public.gmail_connections;
create policy "Users read own gmail_connections"
  on public.gmail_connections for select
  using (auth.uid() = user_id);

drop policy if exists "Service role full access gmail_connections" on public.gmail_connections;
create policy "Service role full access gmail_connections"
  on public.gmail_connections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
