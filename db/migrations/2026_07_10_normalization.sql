-- MIRAX Phase 1 — Normalizzazione risultati ricerca
-- Step 1.2: tabella search_leads (ibrido hot columns + payload jsonb)
-- searches.results RESTA per backward compatibility (dual-write in Step 1.3)
--
-- Hot columns aggiunte su richiesta:
--   website_domain, partita_iva  → entity resolution / Neo4j MERGE (Fase 3)
--   has_pixel                    → filtri tecnici ultra-fast (UQE Fase 4)

-- ============================================================
-- 1. Funzione generica updated_at (riusabile su altre tabelle)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2. Tabella search_leads
-- ============================================================
create table if not exists public.search_leads (
  id              uuid primary key default gen_random_uuid(),
  search_id       uuid not null references public.searches(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  position        integer not null default 0,

  -- Identità (hot, indicizzate)
  azienda         text,
  telefono        text,
  email           text,
  sito            text,
  citta           text,
  categoria       text,
  rating          numeric(4, 1),

  -- Entity resolution (Neo4j MERGE keys)
  website_domain  text,
  partita_iva     text,

  -- Filtro tecnico core
  has_pixel       boolean,

  -- Dedup per job (tel:… / web:domain / name:…)
  dedupe_key      text,

  -- Score query-aware (UQE Fase 4)
  query_score     smallint check (query_score is null or (query_score >= 0 and query_score <= 100)),
  query_tier      text check (
    query_tier is null
    or query_tier in ('caldissimo', 'caldo', 'tiepido', 'freddo')
  ),

  -- Payload completo = oggetto legacy searches.results[i]
  payload         jsonb not null default '{}'::jsonb,

  -- Lifecycle enrichment / audit
  audit_status    text not null default 'pending'
    check (audit_status in ('pending', 'complete', 'error')),
  enrich_status   text not null default 'pending'
    check (enrich_status in ('pending', 'partial', 'complete', 'error')),
  enriched_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint search_leads_search_dedupe_unique unique (search_id, dedupe_key)
);

comment on table public.search_leads is
  'Lead normalizzati per job discovery. payload = mirror JSONB legacy; hot columns per query/index/Neo4j.';
comment on column public.search_leads.website_domain is
  'Dominio normalizzato (no www, no path) — chiave MERGE Neo4j Company node.';
comment on column public.search_leads.partita_iva is
  'P.IVA normalizzata (11 cifre) — chiave alternativa entity resolution / OpenAPI.';
comment on column public.search_leads.has_pixel is
  'null = audit non eseguito; true/false = esito audit Meta Pixel.';
comment on column public.search_leads.payload is
  'Oggetto lead completo (audit, signals, claude_enrichment, …) — source of truth arricchimento.';

-- ============================================================
-- 3. Indici
-- ============================================================
create index if not exists search_leads_search_id_idx
  on public.search_leads (search_id);

create index if not exists search_leads_search_position_idx
  on public.search_leads (search_id, position);

create index if not exists search_leads_user_id_idx
  on public.search_leads (user_id);

create index if not exists search_leads_website_domain_idx
  on public.search_leads (website_domain)
  where website_domain is not null;

create index if not exists search_leads_partita_iva_idx
  on public.search_leads (partita_iva)
  where partita_iva is not null;

-- Filtro ultra-fast: lead senza pixel (has_pixel IS NOT TRUE copre false + null audit opzionale)
create index if not exists search_leads_search_no_pixel_idx
  on public.search_leads (search_id)
  where has_pixel is not true;

create index if not exists search_leads_has_pixel_idx
  on public.search_leads (search_id, has_pixel)
  where has_pixel is not null;

create index if not exists search_leads_payload_gin_idx
  on public.search_leads using gin (payload jsonb_path_ops);

create index if not exists search_leads_enrich_status_idx
  on public.search_leads (search_id, enrich_status);

-- ============================================================
-- 4. Trigger updated_at
-- ============================================================
drop trigger if exists tr_search_leads_set_updated_at on public.search_leads;

create trigger tr_search_leads_set_updated_at
  before update on public.search_leads
  for each row
  execute function public.set_updated_at();

-- ============================================================
-- 5. Row Level Security
-- ============================================================
alter table public.search_leads enable row level security;

drop policy if exists "Users read own search_leads" on public.search_leads;
create policy "Users read own search_leads"
  on public.search_leads for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.searches s
      where s.id = search_leads.search_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users insert own search_leads" on public.search_leads;
create policy "Users insert own search_leads"
  on public.search_leads for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.searches s
      where s.id = search_leads.search_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users update own search_leads" on public.search_leads;
create policy "Users update own search_leads"
  on public.search_leads for update
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.searches s
      where s.id = search_leads.search_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.searches s
      where s.id = search_leads.search_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Users delete own search_leads" on public.search_leads;
create policy "Users delete own search_leads"
  on public.search_leads for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.searches s
      where s.id = search_leads.search_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Service role full access search_leads" on public.search_leads;
create policy "Service role full access search_leads"
  on public.search_leads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Refresh PostgREST schema cache (Supabase)
notify pgrst, 'reload schema';
