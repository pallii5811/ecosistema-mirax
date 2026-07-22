# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-22 02:00 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Ultimo SHA immutabile verificato su local/remote/worker/frontend: `e647af8237d3d91d670fd1371a50e3250ec443ae`.
- Worker release `20260722_011527`; preview `dpl_8DbFegzpkP9ASzG9LLV7Fy8ui574`.
- Worker persistenti `inactive/disabled`; produzione intatta; zero pubblicazioni/addebiti cliente.
- Canary pre-correzione Market Scope: search `de2ae913-4327-4005-a045-47e437f9863d`, canary `d11134e4-6562-4749-989f-7116ac436820`, `0/3`, costo `EUR 0,109358`, termination `partial_budget_exhausted`, reservation zero.
- Costo live cumulativo missione: `EUR 0,240802` su hard ceiling `EUR 2,70`.

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
- Diff/secret scan, commit/push atomico e deploy worker/frontend sul nuovo SHA.
- Solo dopo SHA immutabile e runtime pulito: un nuovo canary antincendio identico, max `EUR 0,20`, riusando cache e candidati precedenti.
