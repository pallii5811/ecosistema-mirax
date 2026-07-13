-- Charge user credits only for durable, evidence-gated publications.

create table if not exists public.search_credit_charges (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id),
  candidate_id uuid not null references public.search_candidates(id),
  publication_id uuid not null references public.search_publications(id),
  user_id uuid not null references auth.users(id),
  credits integer not null default 1 check (credits > 0),
  status text not null default 'charged' check (status in ('charged', 'refunded')),
  charged_at timestamptz not null default now(),
  refunded_at timestamptz,
  refund_reason text,
  unique(user_id, publication_id),
  unique(user_id, candidate_id)
);

alter table public.search_credit_charges enable row level security;
revoke all on public.search_credit_charges from public, anon, authenticated;
grant all on public.search_credit_charges to service_role;

create or replace function public.charge_search_publications(p_search_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_credits integer;
  v_charged integer := 0;
  v_row record;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'INVALID_CHARGE_LIMIT'; end if;
  if not exists(select 1 from public.searches where id = p_search_id and user_id = v_user) then
    raise exception 'SEARCH_NOT_OWNED';
  end if;

  select credits into v_credits from public.profiles where id = v_user for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if v_credits <= 0 then
    return jsonb_build_object('credits', 0, 'charged', 0);
  end if;

  for v_row in
    select p.id publication_id, p.candidate_id
    from public.search_publications p
    left join public.search_credit_charges c
      on c.user_id = v_user and c.publication_id = p.id
    where p.search_id = p_search_id and p.user_id = v_user and c.id is null
    order by p.published_at asc
    limit least(p_limit, v_credits)
  loop
    insert into public.search_credit_charges(
      search_id, candidate_id, publication_id, user_id, credits, status
    ) values (p_search_id, v_row.candidate_id, v_row.publication_id, v_user, 1, 'charged')
    on conflict do nothing;
    if found then v_charged := v_charged + 1; end if;
  end loop;

  if v_charged > 0 then
    update public.profiles set credits = credits - v_charged where id = v_user;
  end if;
  return jsonb_build_object('credits', v_credits - v_charged, 'charged', v_charged);
end;
$$;

create or replace function public.refund_search_publication_credit(
  p_publication_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.search_credit_charges%rowtype;
begin
  select * into v_charge from public.search_credit_charges
  where publication_id = p_publication_id for update;
  if not found or v_charge.status = 'refunded' then return false; end if;
  update public.search_credit_charges set status = 'refunded', refunded_at = now(),
    refund_reason = left(coalesce(p_reason, 'publication_retracted'), 300)
  where id = v_charge.id;
  update public.profiles set credits = credits + v_charge.credits where id = v_charge.user_id;
  return true;
end;
$$;

revoke all on function public.charge_search_publications(uuid, integer) from public, anon;
grant execute on function public.charge_search_publications(uuid, integer) to authenticated, service_role;
revoke all on function public.refund_search_publication_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_search_publication_credit(uuid, text) to service_role;
