-- Optional: stores requested max lead cap for worker scrape depth.
-- Run in Supabase SQL editor before enabling zone in trigger-scrape.
alter table public.searches add column if not exists zone text;
