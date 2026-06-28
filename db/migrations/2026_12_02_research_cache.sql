-- Fase 6 — cache risultati research agent (24h TTL)
create table if not exists public.research_cache (
  cache_key text primary key,
  lead_website text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists research_cache_expires_idx on public.research_cache (expires_at);
create index if not exists research_cache_website_idx on public.research_cache (lead_website);

alter table public.research_cache enable row level security;

drop policy if exists research_cache_service_only on public.research_cache;
create policy research_cache_service_only on public.research_cache
  for all using (false) with check (false);

comment on table public.research_cache is 'Cache 24h output MIRAX Research Agent — accesso service role only';
