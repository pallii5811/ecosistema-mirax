# MIRAX controlled-safe release dossier v5

Data verifica: 2026-07-12. Questo dossier descrive uno stato sicuro controllato, non l'accettazione finale del prodotto.

## 1. Release manifest

- Manifest hashato: `reports/release-manifest-v5.json`.
- Frontend: `2026-07-12-final-hardening-v5`, alias `https://ecosistema-mirax-two.vercel.app`.
- Backend: frozen release `20260712_201500_v4` su live e staging del server 116.
- Worktree: dirty; nessun commit monolitico è stato creato. Le modifiche dell'utente sono state preservate.
- Acceptance finale: `false`.

## 2. Deployment report

- Vercel deployment immutable URL: `https://ecosistema-mirax-7hbcjzbic-simodepertis-projects.vercel.app`.
- Marker pubblico verificato v5 con `production_search_disabled=true`.
- Backend audit API staging healthy.
- Dieci worker verificati inactive+disabled; `ANTHROPIC_EXTRACT_ENABLED=0`.
- Review umana disponibile a `/dashboard/evaluation`, allowlist fail-closed.

## 3. Migration manifest

- Inventario repository: 46 migration SQL con SHA-256 nel release manifest.
- Gate finali applicati e verificati: commercial lifecycle, atomic cost governor, evidence/entity contract, publication credit ledger, evaluation/canary framework.
- RLS verificata sulle tabelle lifecycle, budget, crediti, evaluation e canary.
- RPC publish/reserve negate ad anon/authenticated e concesse a service role.

## 4. Prompt e model report

- Canonical intent prompt: `commercial-intent-v1.0.0`.
- Contract schema: `1.0.0`; source registry: 15 classi; signal ontology: 43 segnali.
- Modello configurabile: `claude-sonnet-5`; valori environment ripuliti da terminatori reali/escaped.
- Anthropic compiler: massimo initial + un repair; entrambe le chiamate richiedono reservation persistente.
- Worker extraction/query generation: stesso provider family, ma disabilitati nello stato corrente.
- OpenAI: nessun endpoint autorizzato; guard statico PASS. Il vecchio research agent resta una compatibility surface disabilitata.

## 5. Test report

- TypeScript PASS; Next production build PASS, 126 route/page.
- Contract/source/ontology 9/9; compiler normalization 12/12; evaluation security 10/10.
- Commercial matrix 137/137 su 15 seller category; parser real-user 55/55; routing 13/13.
- Runtime commercial 44/44; backend quality 19/19; canonical boundary 9/9; lifecycle/governor 13/13.
- Preflight v5 post-rollback PASS su frontend, DB e server reali.

## 6. Failure injection report

- DB unavailable: paid work fail-closed.
- Neo4j sidecar unavailable: Postgres lifecycle resta autorevole.
- Unsafe URL/DNS/redirect/Playwright requests: bloccati.
- Concurrent reservation: una accettata, una bloccata, overspend zero.
- Provider delivery incerta: settlement conservativo, non release a costo zero.

## 7. Soak report

- Evidenza: `reports/final-safety-soak-v5.json`.
- 17/17 check PASS in 393.404 ms.
- Cinque cicli completi di atomic cost, concurrent reservation e publication credit ledger.
- Provider chiamati: 0; worker avviati: 0; pubblicazioni cliente: 0.

## 8–13. Canary, human review e metriche finali

- Canary intent live precedenti: 2 quarantined; costo €0,05 + €0,10; zero lead/pubblicazioni.
- Compiler v4/v5 normalizzato offline, ma nessun ulteriore canary è stato eseguito.
- Gold cases: 200/200 candidati reali, 200 domini unici, 10 verticali.
- Human judgments: 0/200. Di conseguenza precision, Wilson CI, evidence/domain/date/contact coverage e cold/warm cost per published lead restano **non misurati**.
- Manifest multi-verticale pronto: 10 verticali, shadow-only, massimo suite €1,250. Non eseguito.

## 14. Credit reconciliation

- Negative balances: 0.
- Duplicate charges: 0.
- Refunded publications: 0; charged publications: 0 nello schema v4 non ancora aperto al traffico.
- Charge consentito solo dopo durable publication; refund idempotente.
- Cinque cicli transazionali del validator credit ledger: PASS.

## 15. Security e SSRF

- URL scheme/credentials/port/DNS public-address/redirect verificati prima del fetch.
- Playwright request guard installato per pagina.
- Evaluation data e lifecycle non leggibili da client anonimo.
- Review API anonima verificata HTTP 401; reviewer allowlist obbligatoria, vuota = HTTP 503.
- Secret scan repository: nessuna chiave Anthropic/Serper nota trovata.

## 16. Rollback

- Rehearsal post-swap corretto: PASS. Evidenza `reports/rollback-rehearsal-v5.json`.
- Runbook: `docs/release-v5/ROLLBACK_RUNBOOK.md`.

## 17. Incident e kill switch

- Runbook: `docs/release-v5/INCIDENT_KILL_SWITCH_RUNBOOK.md`.

## 18. Customer launch checklist

- Checklist: `docs/release-v5/CUSTOMER_LAUNCH_CHECKLIST.md`.
- Lo stage 1 non è autorizzato finché i gate human/canary/metriche non passano.

## 19. Limitazioni non critiche e blocker

- Worktree non consolidato per responsabilità; serve review/staging selettivo prima del commit.
- Certificato locale richiede eccezione TLS limitata ai processi CLI sul PC corrente; il runtime pubblico usa TLS valido.
- Dataset deriva da risultati storici e osservazioni grafo; ogni etichetta richiede verifica umana della fonte corrente.
- Il grafo contiene volume utile, ma non prova da solo precisione commerciale.
- Nessuna promessa di numero lead garantito quando l'universo qualificato è inferiore al target.

## FAILED GATE

- Human judgments: 0/200, richiesto 200/200.
- Intent canary v5: non eseguito dopo la correzione.
- Multi-vertical canary: 0/10 completati.
- Precision/costo/coverage finali: non misurati.

La frase finale del Master Plan resta vietata.
