-- ============================================================================
-- Migration: link lists to environments (optional 1:N — one environment holds many lists)
-- Run this on your Supabase SQL editor.
-- ============================================================================

-- 1) Add environment_id to lists (nullable — a list can live without an environment).
alter table public.lists
  add column if not exists environment_id uuid references public.environments(id) on delete set null;

create index if not exists lists_environment_id_idx on public.lists(environment_id);

-- 2) Helpful index for the "my lists" page ordering.
create index if not exists lists_user_created_idx on public.lists(user_id, created_at desc);

-- 3) Helpful index for list_leads join.
create index if not exists list_leads_list_id_idx on public.list_leads(list_id);
