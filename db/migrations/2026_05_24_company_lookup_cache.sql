-- Cache layer for OpenAPI.it certified company data.
-- Server-side only: used to avoid duplicate paid OpenAPI calls for the same P.IVA.

create table if not exists public.company_lookup_cache (
  piva text not null,
  source text not null,
  ragione_sociale text,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (piva, source)
);

create index if not exists idx_company_lookup_cache_source on public.company_lookup_cache(source);
create index if not exists idx_company_lookup_cache_expires on public.company_lookup_cache(expires_at);

alter table public.company_lookup_cache enable row level security;

drop policy if exists "Service role full access company_lookup_cache" on public.company_lookup_cache;
create policy "Service role full access company_lookup_cache"
  on public.company_lookup_cache for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.prune_company_lookup_cache()
returns integer as $$
declare
  deleted integer;
begin
  delete from public.company_lookup_cache where expires_at < now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$ language plpgsql security definer;
