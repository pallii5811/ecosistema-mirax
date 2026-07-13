-- Strategia/intento della ricerca in linguaggio naturale, usata dal worker
-- per arricchire i lead con i segnali business corretti.
alter table public.searches add column if not exists intent jsonb;
create index if not exists idx_searches_intent on public.searches using gin (intent);
