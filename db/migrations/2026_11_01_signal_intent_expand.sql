-- Fase 5 — espande tipi segnale business (onnivoro)
alter table public.lead_business_signals drop constraint if exists lead_business_signals_signal_type_check;

alter table public.lead_business_signals add constraint lead_business_signals_signal_type_check
  check (signal_type in (
    'hiring', 'new_location', 'registry_change', 'funding_news',
    'site_stale', 'meta_ads_started', 'google_ads_started',
    'sector_investment', 'tender_won', 'crm_detected', 'crm_change'
  ));
