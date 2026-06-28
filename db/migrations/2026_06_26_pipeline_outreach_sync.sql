-- Blocco 4 — collegamento pipeline ↔ outreach + indice anti-duplicato

alter table public.lead_pipeline
  add column if not exists last_outreach_channel text,
  add column if not exists last_outreach_at timestamptz,
  add column if not exists last_outreach_status text,
  add column if not exists source_outreach_id uuid;

create unique index if not exists lead_pipeline_user_website_uidx
  on public.lead_pipeline (user_id, lower(btrim(lead_website)))
  where lead_website is not null and btrim(lead_website) <> '';

create index if not exists lead_pipeline_user_outreach_idx
  on public.lead_pipeline (user_id, last_outreach_at desc nulls last);

-- Service role già coperto da policy esistenti su lead_pipeline
