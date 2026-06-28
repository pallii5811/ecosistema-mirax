-- ============================================================================
-- Blocco 5 — Knowledge Objects + pgvector (CKBase-lite)
-- ============================================================================

create extension if not exists vector;

create table if not exists public.knowledge_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment_id uuid references public.environments(id) on delete set null,
  object_type text not null
    check (object_type in ('pattern', 'insight', 'correlation', 'closure')),
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'manual'
    check (source in ('manual', 'pipeline', 'outreach', 'environment', 'cron')),
  confidence numeric not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  embedding vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_objects_user_idx
  on public.knowledge_objects (user_id, created_at desc);

create index if not exists knowledge_objects_env_idx
  on public.knowledge_objects (environment_id, created_at desc)
  where environment_id is not null;

create unique index if not exists knowledge_objects_dedupe_idx
  on public.knowledge_objects (user_id, object_type, title);

create index if not exists knowledge_objects_embedding_hnsw_idx
  on public.knowledge_objects
  using hnsw (embedding vector_cosine_ops);

alter table public.knowledge_objects enable row level security;

drop policy if exists "knowledge_objects_own" on public.knowledge_objects;
create policy "knowledge_objects_own" on public.knowledge_objects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "knowledge_objects_service" on public.knowledge_objects;
create policy "knowledge_objects_service" on public.knowledge_objects
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Similarity search (cosine distance)
create or replace function public.match_knowledge_objects(
  query_embedding vector(384),
  match_count int default 10,
  filter_user_id uuid default null,
  filter_environment_id uuid default null
)
returns table (
  id uuid,
  object_type text,
  title text,
  body text,
  payload jsonb,
  source text,
  confidence numeric,
  environment_id uuid,
  similarity float
)
language sql stable
as $$
  select
    k.id,
    k.object_type,
    k.title,
    k.body,
    k.payload,
    k.source,
    k.confidence,
    k.environment_id,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_objects k
  where k.embedding is not null
    and (filter_user_id is null or k.user_id = filter_user_id)
    and (filter_environment_id is null or k.environment_id = filter_environment_id)
  order by k.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;
