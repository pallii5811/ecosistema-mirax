-- Fase 8 — Realtime push su nuovi segnali business
alter table public.lead_business_signals replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_business_signals'
  ) then
    alter publication supabase_realtime add table public.lead_business_signals;
  end if;
end $$;

-- Utenti possono ricevere i propri INSERT via realtime (SELECT policy già presente)
comment on table public.lead_business_signals is 'Segnali business per lead — Realtime INSERT abilitato (Fase 8)';
