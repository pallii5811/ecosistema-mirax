# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-22 04:10 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Ultimo SHA Market Scope verificato su local/remote/worker/frontend: `de253445737d2615f4beab9da574f3991a436e2c`.
- Worker release `20260722_020817`; preview `dpl_GaqFYw3J9Ltf5d2rntfZq585R5DZ`.
- Worker persistenti `inactive/disabled`; produzione intatta; zero pubblicazioni/addebiti cliente.
- Canary pre-correzione Market Scope: search `de2ae913-4327-4005-a045-47e437f9863d`, canary `d11134e4-6562-4749-989f-7116ac436820`, `0/3`, costo `EUR 0,109358`, termination `partial_budget_exhausted`, reservation zero.
- Costo live cumulativo missione: `EUR 0,240802` su hard ceiling `EUR 2,70`.
- Canary post-Market-Scope `c1ca7cb4-c082-4ef2-bc99-b721baca8089`: `0/3`, costo `EUR 0,100000`, quarantinato; cumulativo `EUR 0,340802`.
- Primo loss point: 40 pagine acquisite, 0 persistite; `BeautifulSoup Tag.attrs=None` causava `PAGE_FETCH_FAILED:AttributeError` dopo la decompose di contenitori rumorosi.

## Correzione Market Scope in validazione
- Nuovi stati: `CONFIRMED_SME`, `LIKELY_SME`, `ENTERPRISE`, `AMBIGUOUS_CORPORATE`.
- Headcount assente non genera piu `SIZE_UNVERIFIED`: azienda reale con dominio, contatto e nessun indicatore enterprise diventa `LIKELY_SME` pubblicabile.
- Listed, multinational, global brand, major operator, enterprise scale e large/global parent restano respinti come `ENTERPRISE`.
- Segnali corporate contraddittori o parent/ownership irrisolti restano in hold come `AMBIGUOUS_CORPORATE`.
- Identity operativa separata dal size gate; identity, evidence, geography, freshness, contact e actor-role restano fail-closed.
- Stato propagato in LeadAcceptanceDecision, lifecycle payload, API/UI e CSV.
- Top-level email/phone/contact page riconosciuti dal contact gate; contatti publisher restano esclusi dagli altri gate.

## Gate offline correnti
- Market Scope, lifecycle, publication e replay: `57 passed`; replay invariato a `50 ACCEPT + 50 REJECT`.
- Commercial runtime/cost: `81 passed`; reserve-before-call verde.
- Commercial contract/ontology/compiler verde; compiler tiered `50/50`.
- Python e TypeScript compile verdi; Next production build verde.
- Trenord, PwC e Abbott restano respinti anche senza headcount.

## Prossimo passo sicuro
- Commit/push/deploy della correzione fetch e del pre-filtro expansion-event zero-cost.
- Solo dopo SHA immutabile e runtime pulito: un canary antincendio identico, max `EUR 0,20`.
