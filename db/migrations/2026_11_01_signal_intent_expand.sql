-- Fase 5 — espande tipi segnale business (onnivoro)
alter table public.lead_business_signals drop constraint if exists lead_business_signals_signal_type_check;

-- Coerce any legacy/unknown signal types to a generic bucket before re-adding
-- the check constraint, so existing data does not block the migration.
update public.lead_business_signals
set signal_type = 'registry_change'
where signal_type not in (
  'hiring', 'new_location', 'registry_change', 'funding_news',
  'site_stale', 'meta_ads_started', 'google_ads_started',
  'sector_investment', 'tender_won', 'crm_detected', 'crm_change'
);

alter table public.lead_business_signals add constraint lead_business_signals_signal_type_check
  check (signal_type in (
    'hiring', 'new_location', 'registry_change', 'funding_news',
    'site_stale', 'meta_ads_started', 'google_ads_started',
    'sector_investment', 'tender_won', 'crm_detected', 'crm_change'
  ));
