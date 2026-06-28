-- PostgREST requires FK relationships for nested selects (list_leads → leads, lists).
-- Fixes: "Could not find a relationship between 'list_leads' and 'leads' in the schema cache"

-- Remove orphan join rows before adding constraints.
delete from public.list_leads ll
where not exists (select 1 from public.lists l where l.id = ll.list_id);

delete from public.list_leads ll
where not exists (select 1 from public.leads l where l.id = ll.lead_id);

alter table public.list_leads
  drop constraint if exists list_leads_list_id_fkey;

alter table public.list_leads
  drop constraint if exists list_leads_lead_id_fkey;

alter table public.list_leads
  add constraint list_leads_list_id_fkey
  foreign key (list_id) references public.lists(id) on delete cascade;

alter table public.list_leads
  add constraint list_leads_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete cascade;

create index if not exists list_leads_lead_id_idx on public.list_leads(lead_id);

-- Refresh PostgREST schema cache (Supabase).
notify pgrst, 'reload schema';
