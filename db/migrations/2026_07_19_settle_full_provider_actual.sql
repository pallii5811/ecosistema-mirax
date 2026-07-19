-- Record full provider actual on settle. Budget recognition / overshoot are metadata only.
-- Overspend prevention remains reserve(upper_bound) before each paid call.

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
  v_without_current numeric(18,8);
  v_remaining numeric(18,8);
  v_recognized numeric(18,8);
  v_overshoot numeric(18,8);
  v_overshot boolean := false;
begin
  if p_actual_cost_eur < 0 then raise exception 'INVALID_ACTUAL_COST'; end if;
  select * into v_state from public.search_budget_state where search_id = p_search_id for update;
  if not found then raise exception 'SEARCH_BUDGET_NOT_INITIALIZED'; end if;
  select * into v_entry from public.search_cost_ledger
    where search_id = p_search_id and idempotency_key = p_idempotency_key for update;
  if not found then raise exception 'COST_RESERVATION_NOT_FOUND'; end if;
  if v_entry.status = 'settled' then return v_entry; end if;
  if v_entry.status <> 'reserved' then raise exception 'COST_RESERVATION_NOT_SETTLEABLE'; end if;

  v_without_current := greatest(0, v_state.committed_cost_eur - v_entry.estimated_cost_eur);
  v_remaining := greatest(0, v_state.hard_cost_eur - v_without_current);
  if p_actual_cost_eur > v_remaining then
    v_overshot := true;
  end if;
  v_recognized := least(p_actual_cost_eur, v_remaining);
  v_overshoot := greatest(0, p_actual_cost_eur - v_recognized);
  v_new_committed := v_without_current + p_actual_cost_eur;

  update public.search_cost_ledger set
    actual_cost_eur = p_actual_cost_eur,
    status = 'settled',
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'partial_budget_exhausted', v_overshot,
      'provider_actual_cost_eur', p_actual_cost_eur,
      'budget_recognized_cost_eur', v_recognized,
      'budget_overshoot_eur', v_overshoot
    ),
    settled_at = now(), reservation_expires_at = null
  where id = v_entry.id returning * into v_entry;

  update public.search_budget_state set
    committed_cost_eur = v_new_committed,
    status = case when v_overshot or v_new_committed >= hard_cost_eur then 'halted' else status end,
    halt_reason = case
      when v_overshot or v_new_committed >= hard_cost_eur then 'partial_budget_exhausted'
      else halt_reason
    end,
    updated_at = now()
  where search_id = p_search_id;
  return v_entry;
end;
$$;
