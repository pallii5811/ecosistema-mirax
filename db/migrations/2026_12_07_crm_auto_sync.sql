-- Fase 11 — CRM auto-sync (estende crm_integrations esistente)
-- Idempotente: crea tabella base se manca (dev/staging), poi aggiunge colonne Fase 11.

create table if not exists public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  name text not null default '',
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  leads_synced integer not null default 0,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_integrations
  add column if not exists auto_sync_hot_leads boolean not null default false,
  add column if not exists auto_create_deals boolean not null default false,
  add column if not exists field_mapping jsonb not null default '{}'::jsonb;

create index if not exists idx_crm_integrations_user_active
  on public.crm_integrations (user_id, is_active);

comment on column public.crm_integrations.auto_sync_hot_leads is 'Sync automatico lead con Intent Score >= 60';
comment on column public.crm_integrations.auto_create_deals is 'Crea deal CRM quando Intent Score >= 80';
