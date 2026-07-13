-- Internal v5 shadow candidates have no customer owner and can never be
-- published. This lets the exact production quality gate persist evaluation
-- outcomes without attaching them to a customer or charging customer credit.

alter table public.search_candidates
  alter column user_id drop not null;

alter table public.search_candidates
  drop constraint if exists search_candidates_published_owner_gate;

alter table public.search_candidates
  add constraint search_candidates_published_owner_gate
  check (stage <> 'published' or user_id is not null);

comment on column public.search_candidates.user_id is
  'Customer owner. NULL is reserved for internal shadow evaluation candidates, which cannot be published.';

