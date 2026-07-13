-- Crash-safe worker ownership and observable search progress.
-- A lease is renewed while a worker publishes results; only expired leases may
-- be recovered. This avoids duplicate execution of legitimate long searches.

alter table public.searches add column if not exists worker_id text;
alter table public.searches add column if not exists heartbeat_at timestamptz;
alter table public.searches add column if not exists lease_expires_at timestamptz;
alter table public.searches add column if not exists attempt_count integer not null default 0;
alter table public.searches add column if not exists progress jsonb not null default '{}'::jsonb;
alter table public.searches add column if not exists updated_at timestamptz not null default now();

create index if not exists searches_processing_lease_idx
  on public.searches (lease_expires_at)
  where status = 'processing';

comment on column public.searches.lease_expires_at is
  'Exclusive worker lease deadline. A processing job may be recovered only after this instant.';
comment on column public.searches.progress is
  'Low-frequency search progress snapshot for realtime UI and operations.';

create or replace function public.searches_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_searches_touch_updated_at on public.searches;
create trigger tr_searches_touch_updated_at
  before update on public.searches
  for each row execute function public.searches_touch_updated_at();
