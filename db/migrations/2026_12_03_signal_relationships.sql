-- Fase 7.2 — Signal graph relationships (intent score boost)
create table if not exists public.signal_relationships (
  id uuid primary key default gen_random_uuid(),
  signal_a_type varchar(50) not null,
  signal_b_type varchar(50) not null,
  relationship varchar(20) not null check (relationship in ('reinforces', 'contradicts', 'enables')),
  weight float not null check (weight >= 0 and weight <= 1),
  description text,
  unique (signal_a_type, signal_b_type, relationship)
);

insert into public.signal_relationships (signal_a_type, signal_b_type, relationship, weight, description) values
  ('hiring', 'crm_change', 'reinforces', 0.9, 'Assumere + cambio CRM = forte intent di digital transformation'),
  ('funding_received', 'expansion', 'reinforces', 0.85, 'Funding + espansione = budget confermato'),
  ('tender_won', 'hiring', 'enables', 0.7, 'Vittoria gara richiede nuovo personale'),
  ('site_stale', 'hiring', 'contradicts', 0.4, 'Sito datato ma assumono = mixed signal')
on conflict (signal_a_type, signal_b_type, relationship) do nothing;

alter table public.signal_relationships enable row level security;

drop policy if exists signal_relationships_read on public.signal_relationships;
create policy signal_relationships_read on public.signal_relationships
  for select using (true);

comment on table public.signal_relationships is 'Grafo relazioni tra tipi di segnale per intent score boost';
