-- MIRAX atomic marginal-cost governor.
-- The database is the sole authority for distributed reservations: local in-memory
-- governors remain fast-path helpers, never the final spending gate.

alter table public.search_cost_ledger
  add column if not exists currency text not null default 'EUR',
  add column if not exists cache_hit boolean not null default false,
  add column if not exists retry_of_id uuid references public.search_cost_ledger(id) on delete set null,
  add column if not exists reservation_expires_at timestamptz,
  add column if not exists error_code text;

create table if not exists public.search_budget_state (
  search_id uuid primary key references public.searches(id) on delete cascade,
  target_cost_eur numeric(18,8) not null check (target_cost_eur >= 0),
  hard_cost_eur numeric(18,8) not null check (hard_cost_eur > 0),
  committed_cost_eur numeric(18,8) not null default 0 check (committed_cost_eur >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'active' check (status in ('active', 'halted', 'closed')),
  halt_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_cost_eur <= hard_cost_eur)
);

alter table public.search_budget_state enable row level security;
revoke all on public.search_budget_state from public, anon, authenticated;
grant all on public.search_budget_state to service_role;

create or replace function public.mirax_search_requested_leads(p_search_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(10000,
    case
      when coalesce(intent->>'requested_leads', intent->>'max_leads', intent->>'lead_target', '') ~ '^[0-9]+$'
        then coalesce(intent->>'requested_leads', intent->>'max_leads', intent->>'lead_target')::integer
      when coalesce(zone, '') ~ '^[0-9]+$'
        then zone::integer
      when coalesce(zone, '') ~ '^max:[0-9]+$'
        then substring(zone from 5)::integer
      else 1
    end
  ))
  from public.searches
  where id = p_search_id;
$$;

create or replace function public.initialize_search_budget(
  p_search_id uuid,
  p_target_cost_eur numeric,
  p_hard_cost_eur numeric
)
returns public.search_budget_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested integer;
  v_max_hard numeric(18,8);
  v_state public.search_budget_state%rowtype;
begin
  if p_target_cost_eur < 0 or p_hard_cost_eur <= 0 or p_target_cost_eur > p_hard_cost_eur then
    raise exception 'INVALID_SEARCH_BUDGET';
  end if;

  v_requested := public.mirax_search_requested_leads(p_search_id);
  if v_requested is null then
    raise exception 'SEARCH_NOT_FOUND';
  end if;
  v_max_hard := round(v_requested * 0.025, 8);
  if p_hard_cost_eur > v_max_hard then
    raise exception 'HARD_BUDGET_ABOVE_PRODUCT_CAP';
  end if;

  insert into public.search_budget_state(search_id, target_cost_eur, hard_cost_eur)
  values (p_search_id, p_target_cost_eur, p_hard_cost_eur)
  on conflict (search_id) do nothing;

  select * into v_state
  from public.search_budget_state
  where search_id = p_search_id
  for update;

  -- Initialization is immutable: a retry can confirm the same/lower cap, never raise it.
  if p_hard_cost_eur > v_state.hard_cost_eur then
    raise exception 'BUDGET_ESCALATION_FORBIDDEN';
  end if;
  return v_state;
end;
$$;

create or replace function public.reserve_search_cost(
  p_search_id uuid,
  p_idempotency_key text,
  p_operation_type text,
  p_estimated_cost_eur numeric,
  p_provider text default null,
  p_model text default null,
  p_source_class text default null,
  p_candidate_id uuid default null,
  p_units numeric default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 900,
  p_retry_of_id uuid default null,
  p_cache_hit boolean default false
)
returns public.search_cost_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.search_budget_state%rowtype;
  v_existing public.search_cost_ledger%rowtype;
  v_entry public.search_cost_ledger%rowtype;
begin
  if nullif(trim(p_idempotency_key), '') is null or nullif(trim(p_operation_type), '') is null then
    raise exception 'INVALID_COST_RESERVATION_IDENTITY';
  end if;
  if p_estimated_cost_eur < 0 or p_units < 0 or p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'INVALID_COST_RESERVATION';
  end if;

  select * into v_state
  from public.search_budget_state
  where search_id = p_search_id
  for update;
  if not found then raise exception 'SEARCH_BUDGET_NOT_INITIALIZED'; end if;

  select * into v_existing
  from public.search_cost_ledger
  where search_id = p_search_id and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if v_state.status <> 'active' then raise exception 'SEARCH_BUDGET_HALTED'; end if;
  if v_state.committed_cost_eur + p_estimated_cost_eur > v_state.hard_cost_eur then
    update public.search_budget_state
      set status = 'halted', halt_reason = 'projected_hard_budget_exceeded', updated_at = now()
      where search_id = p_search_id;
    raise exception 'RESEARCH_HARD_BUDGET_EXCEEDED';
  end if;

  insert into public.search_cost_ledger(
    search_id, candidate_id, operation_type, source_class, provider, model, units,
    estimated_cost_eur, status, idempotency_key, metadata, currency, cache_hit,
    retry_of_id, reservation_expires_at
  ) values (
    p_search_id, p_candidate_id, p_operation_type, p_source_class, p_provider, p_model,
    p_units, p_estimated_cost_eur, 'reserved', p_idempotency_key, coalesce(p_metadata, '{}'::jsonb),
    'EUR', p_cache_hit, p_retry_of_id, now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_entry;

  update public.search_budget_state
    set committed_cost_eur = committed_cost_eur + p_estimated_cost_eur, updated_at = now()
    where search_id = p_search_id;
  return v_entry;
end;
$$;

create or replace function public.settle_search_cost(
  p_search_id uuid,
  p_idempotency_key text,
  p_actual_cost_eur numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns public.search_cost_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.search_budget_state%rowtype;
  v_entry public.search_cost_ledger%rowtype;
  v_new_committed numeric(18,8);
begin
  if p_actual_cost_eur < 0 then raise exception 'INVALID_ACTUAL_COST'; end if;
  select * into v_state from public.search_budget_state where search_id = p_search_id for update;
  if not found then raise exception 'SEARCH_BUDGET_NOT_INITIALIZED'; end if;
  select * into v_entry from public.search_cost_ledger
    where search_id = p_search_id and idempotency_key = p_idempotency_key for update;
  if not found then raise exception 'COST_RESERVATION_NOT_FOUND'; end if;
  if v_entry.status = 'settled' then return v_entry; end if;
  if v_entry.status <> 'reserved' then raise exception 'COST_RESERVATION_NOT_SETTLEABLE'; end if;

  v_new_committed := greatest(0, v_state.committed_cost_eur - v_entry.estimated_cost_eur + p_actual_cost_eur);
  update public.search_cost_ledger set
    actual_cost_eur = p_actual_cost_eur,
    status = 'settled',
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
    settled_at = now(), reservation_expires_at = null
  where id = v_entry.id returning * into v_entry;

  update public.search_budget_state set
    committed_cost_eur = v_new_committed,
    status = case when v_new_committed > hard_cost_eur then 'halted' else status end,
    halt_reason = case when v_new_committed > hard_cost_eur then 'actual_hard_budget_exceeded' else halt_reason end,
    updated_at = now()
  where search_id = p_search_id;
  return v_entry;
end;
$$;

create or replace function public.release_search_cost(
  p_search_id uuid,
  p_idempotency_key text,
  p_status text default 'released',
  p_error_code text default null
)
returns public.search_cost_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.search_cost_ledger%rowtype;
begin
  if p_status not in ('released', 'failed') then raise exception 'INVALID_RELEASE_STATUS'; end if;
  perform 1 from public.search_budget_state where search_id = p_search_id for update;
  select * into v_entry from public.search_cost_ledger
    where search_id = p_search_id and idempotency_key = p_idempotency_key for update;
  if not found then raise exception 'COST_RESERVATION_NOT_FOUND'; end if;
  if v_entry.status in ('released', 'failed', 'settled') then return v_entry; end if;

  update public.search_cost_ledger set status = p_status, error_code = p_error_code,
    settled_at = now(), reservation_expires_at = null
  where id = v_entry.id returning * into v_entry;
  update public.search_budget_state set
    committed_cost_eur = greatest(0, committed_cost_eur - v_entry.estimated_cost_eur), updated_at = now()
  where search_id = p_search_id;
  return v_entry;
end;
$$;

create or replace function public.release_stale_search_costs(p_search_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform 1 from public.search_budget_state where search_id = p_search_id for update;
  select count(*) into v_count
  from public.search_cost_ledger
  where search_id = p_search_id and status = 'reserved' and reservation_expires_at < now();
  -- A crashed caller may have reached the provider after reserving. Conservatively
  -- settle at the reserved estimate: never pretend the operation was free.
  update public.search_cost_ledger set status = 'failed', actual_cost_eur = estimated_cost_eur,
    error_code = 'STALE_RESERVATION_CONSERVATIVE_SETTLEMENT',
    settled_at = now(), reservation_expires_at = null
  where search_id = p_search_id and status = 'reserved' and reservation_expires_at < now();
  update public.search_budget_state set updated_at = now() where search_id = p_search_id;
  return v_count;
end;
$$;

revoke all on function public.mirax_search_requested_leads(uuid) from public, anon, authenticated;
revoke all on function public.initialize_search_budget(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.reserve_search_cost(uuid, text, text, numeric, text, text, text, uuid, numeric, jsonb, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public.settle_search_cost(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.release_search_cost(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.release_stale_search_costs(uuid) from public, anon, authenticated;
grant execute on function public.mirax_search_requested_leads(uuid) to service_role;
grant execute on function public.initialize_search_budget(uuid, numeric, numeric) to service_role;
grant execute on function public.reserve_search_cost(uuid, text, text, numeric, text, text, text, uuid, numeric, jsonb, integer, uuid, boolean) to service_role;
grant execute on function public.settle_search_cost(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.release_search_cost(uuid, text, text, text) to service_role;
grant execute on function public.release_stale_search_costs(uuid) to service_role;
