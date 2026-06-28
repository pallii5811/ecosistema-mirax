# Ecosistema MIRAX — Roadmap tecnica

**Repo:** `pallii5811/ecosistema-mirax`  
**Cartella locale:** `WEB APP CKB - Dev`  
**Regola:** commit e sviluppo solo qui. `WEB APP CKB - Copia` = produzione (`miraxgroup.it`), intoccabile salvo hotfix urgenti.

**Escluso da questo documento:** modifiche alla landing / sito corporate CKB (visione, copy, sezioni marketing). Quelle le fa Simone a mano in un secondo momento.

---

## Architettura target

| | Produzione | Dev / Ecosistema |
|---|------------|------------------|
| Cartella | `WEB APP CKB - Copia` | `WEB APP CKB - Dev` |
| GitHub | `miraxgroupckb` | `ecosistema-mirax` |
| Deploy | Vercel → miraxgroup.it | Vercel preview (da configurare) |
| Supabase | produzione | **progetto nuovo** |
| Server | Hetzner **178** (`:8001`) | Hetzner **116** (`:8002` staging) |

---

## Ordine di implementazione (solo tecnico)

### Blocco 0 — Prerequisiti infrastruttura

Senza questo blocco, ogni test dev rischia di toccare la produzione.

| # | Task | Dettaglio | Stato |
|---|------|-----------|-------|
| 0.1 | Progetto **Supabase dev** separato | `ktspchugdwpqvxhmysap` (ecosistema mirax) | ✅ creato |
| 0.2 | Schema + migration su dev | `npm run setup:ecosistema` (dopo chiavi API) | ⬜ **chiavi API** |
| 0.3 | `.env.local` in Dev | `npm run setup:ecosistema` + `check-staging-env` | 🟡 URL/backend ok, mancano chiavi |
| 0.4 | API staging su **116:8002** | `mirax-audit-api-staging.service` | ✅ attivo |
| 0.5 | Worker staging (1–2 istanze) | Stesso codice, `.env` → Supabase dev | ⬜ dopo 0.1 |
| 0.6 | `BACKEND_URL` dev | `http://116.203.137.39:8002` | ✅ default codice Dev |
| 0.7 | Vercel preview | Progetto collegato a `ecosistema-mirax` | ⬜ **azione tua** |
| 0.8 | Regola operativa | Mai deploy worker su **178** senza test su **116:8002** | ⚠️ sempre |

**Guida dettagliata:** `docs/BLOCCO0_SETUP.md`

---

### Blocco 1 — Stabilità ricerca e worker (priorità massima)

Bug reali emersi in produzione (es. Benevento). Da fare per primi sul duplicato.

| # | Task | Dove | Note |
|---|------|------|------|
| 1.1 | **Mercato esaurito** — stop spinner quando Maps non aggiunge lead | `DashboardShell.tsx` + `search-contact-quality.ts` | ✅ |
| 1.2 | Trasparenza contatti | `DashboardShell.tsx` | ✅ banner "X trovati · Y con contatto · Z nascosti" |
| 1.3 | Worker: non bloccare job su **reviews_scraper** | `worker_supabase.py` | ✅ default `ENRICH_REVIEWS=0` |
| 1.4 | `completed` quando Maps esaurito | `worker_supabase.py` | ✅ status `completed` post-scrape |
| 1.5 | Fix merge audit (preferire versione completa) | `_merge_lead_pair` | ✅ |
| 1.6 | Instagram / social su audit API | `process_single_url` | ✅ `missing_instagram` reale |
| 1.7 | Test E2E staging | `npm run test:block1` | ✅ unit + audit E2E |

---

### Blocco 2 — Core prodotto (Lead Generation Engine)

Il motore **esiste già**. Qui si consolida e si chiude il gap tra prodotto reale e promesse tecniche (non landing).

| # | Task | Dove | Note |
|---|------|------|------|
| 2.1 | Audit sito più veloce e affidabile | `audit_engine.py`, `resume-audits`, worker | ✅ timeout ridotti, audit paralleli (×3) |
| 2.2 | Score AI: documentare rule-based vs ML | `docs/SCORE_AI_RULES.md`, `leadIntelligence.ts` | ✅ Nessun ML addestrato |
| 2.3 | Schema Lead Object consolidato | `src/lib/lead-object.ts` | ✅ `lead_object_version` = 2 |
| 2.4 | `freshness_score` su lead | worker + `ResultsTable` + merge | ✅ decay 30gg + badge UI |
| 2.5 | Migration **`zone`** su `searches` | `db/migrations/2026_06_23_searches_zone.sql` | ✅ su dev (setup:ecosistema) |
| 2.6 | `trigger-scrape` allineato a `zone` | `trigger-scrape`, `search-job-payload.ts` | ✅ `max_results` → `zone` |
| 2.7 | Verifica fix **ambienti** (stats dopo attach lista) | `environments/actions.ts`, `lists/.../environment` | ✅ test unit aggregation |
| 2.8 | Crediti e billing invariati | Stripe/PayPal routes | N/A |

---

### Blocco 3 — EDAT lite (Event Driven Action Time)

| # | Task | Dove | Note |
|---|------|------|------|
| 3.1 | Cron **re-audit ogni 30 giorni** | `vercel.json` + `/api/cron/reaudit` | ✅ giornaliero 03:00 UTC |
| 3.2 | Trigger su evento lead | `monitor-lead`, `outreach/log`, consumer | ✅ `mirax_events` + webhook |
| 3.3 | Sequenze event-driven | `sequences-dispatch` + eventi | ✅ `sequence.email_sent` |
| 3.4 | Tabella `events` + consumer | `2026_06_25_edat_events.sql`, `src/lib/events/` | ✅ `mirax_events` + `/api/cron/process-events` |
| 3.5 | "Cosa fare ora" operativo | `/api/insights/actions` | ✅ pipeline + EDAT (stale, alert, outreach) |

---

### Blocco 4 — Pipeline e Self-Adjustment

| # | Task | Dove | Note |
|---|------|------|------|
| 4.1 | Outreach → **pipeline auto-sync** | `pipeline-sync.ts`, `outreach/log` | ✅ sent → contattato, interested → meeting |
| 4.2 | Score adattivo da conversioni | `adaptive-scoring.ts`, `scoring-feedback.ts` | ✅ pesi da outreach + pipeline vinto/perso |
| 4.3 | Pipeline status flow completo | `pipeline-stages.ts`, Kanban UI | ✅ 6 stati CKB + esiti outreach in card |
| 4.4 | Migration outreach su dev | `2026_06_22` + `2026_06_26_pipeline_outreach_sync` | ✅ in `db:apply-dev` |

---

### Blocco 5 — Oggetti CKB (data model)

| Oggetto | Stato |
|---------|--------|
| **Lead Object** | ✅ v2 (`lead-object.ts`) |
| **Scraping Object** | ✅ `searches` + worker |
| **Pipeline Object** | ✅ Blocco 4 |
| **Ambiente Object** | ✅ graph API + SemanticMap reale |
| **Knowledge Object** | ✅ `knowledge_objects` + API + cron feed |
| **Integration Object (NOUS)** | ✅ Blocco 7 |

| # | Task | Dove | Note |
|---|------|------|------|
| 5.1 | Tabella `knowledge_objects` | `2026_06_27_knowledge_objects.sql` | ✅ pattern/insight/correlation/closure |
| 5.2 | API CRUD + query ambiente | `/api/knowledge`, `/api/knowledge/search` | ✅ |
| 5.3 | Alimentazione lead chiusi / pattern | `/api/cron/knowledge-feed` | ✅ pipeline + outreach + stats |
| 5.4 | **SemanticMap** dati reali | `/api/environments/[id]/graph` | ✅ liste + categorie + knowledge |
| 5.5 | **pgvector** CKBase-lite | migration + `match_knowledge_objects` | ✅ embedding 384d deterministico |

---

### Blocco 6 — Cross-Meshing / Value Relations / PKI (versione MIRAX) ✅

Non è "AI emergente magica": motore di correlazione + analytics.

| # | Task | Dove | Note |
|---|------|------|------|
| 6.1 | Correlazione lead per ambiente | `src/lib/environment-correlations.ts` + `/api/insights/correlations` | ✅ mesh per ambiente |
| 6.2 | Pattern chiusura (badge → conversione) | `src/lib/closure-patterns.ts` | ✅ outreach + pipeline |
| 6.3 | API **PKI** (Performance Analysis Indicator) | `src/app/api/insights/pki` | ✅ score 0–100 composito |
| 6.4 | Smart Insights con metriche reali | `insights/ai`, `insights/stats`, dashboard | ✅ no mock lead_interactions |
| 6.5 | Vector search (CKBase-lite) | `/api/insights/knowledge-search` | ✅ pgvector + fallback |

---

### Blocco 7 — Integrazioni (layer NOUS) ✅

| # | Task | Dove | Stato |
|---|------|------|-------|
| 7.1 | Struttura `src/lib/nous/` | `adapters/`, `normalizer.ts`, `dispatcher.ts` | ✅ |
| 7.2 | HubSpot | adapter `nous/adapters/hubspot.ts` | ✅ refactor NOUS |
| 7.3 | Webhook generico (Zapier/Make) | `nous/adapters/webhook` + fan-out `crm-events` | ✅ eventi estesi |
| 7.4 | REST API v1 enterprise | `api/v1/leads` POST, `pipeline`, `outreach` | ✅ espanso |
| 7.5 | **Salesforce connector** | `api/crm/salesforce` + OAuth | ✅ base OAuth + Lead API |
| 7.6 | MS Dynamics / vTiger | `nous/adapters/dynamics`, `vtiger` | ✅ stub adapter |
| 7.7 | MCP server MIRAX (opzionale) | package separato `mirax-mcp` | ⬜ opzionale |

---

### Blocco 8 — Multi-Agent pragmatico ✅

Non serve swarm complesso subito. Agenti = servizi specializzati nel monorepo.

| Agente | Dove | Stato |
|--------|------|-------|
| Search Agent | `src/lib/agents/search-agent.ts` | ✅ NLP / semantic / expand |
| Audit Agent | `src/lib/agents/audit-agent.ts` | ✅ resume-audits unificato |
| Pitch Agent | `src/lib/agents/pitch-agent.ts` | ✅ wrapper generatePitchAction |
| Outreach Agent | `src/lib/agents/outreach-agent.ts` | ✅ guardrail in outreach/log |
| Insights Agent | `src/lib/agents/insights-agent.ts` | ✅ PKI + knowledge → insights/ai |
| Orchestrator | `src/lib/agents/orchestrator.ts` | ✅ registry + pipeline |

| # | Task | Dove | Stato |
|---|------|------|-------|
| 8.1 | Modulo `src/lib/agents/` | orchestrator + registry | ✅ |
| 8.2 | LangGraph / CrewAI | — | ⬜ opzionale (non necessario) |

API: `GET /api/agents`, `POST /api/agents/run`

---

### Blocco 9 — Infrastruttura operativa ✅

| # | Task | Dove | Stato |
|---|------|------|-------|
| 9.1 | Deploy script worker staging → prod | `backend_mirror/scripts/deploy-*.sh` + `DEPLOY_CHECKLIST.md` | ✅ |
| 9.2 | Monitoring / log worker | `monitor-worker.sh`, `/api/ops/worker-health`, `check:worker-health` | ✅ |
| 9.3 | AI Act audit trail | `ai_audit_trail`, `ai-act-audit.ts`, compliance API | ✅ |
| 9.4 | Documentare confini API | `ARCHITETTURA_MIRAX_V2_COMPLETA.md` §21 | ✅ |

---

### Blocco 10 — Promote a produzione

Solo dopo test su staging (116:8002 + Supabase dev).

| # | Task | Note |
|---|------|------|
| 10.1 | Cherry-pick / merge selettivo | `ecosistema-mirax` → `miraxgroupckb` |
| 10.2 | Deploy worker su **178** | Backup + restart one-by-one |
| 10.3 | Migration Supabase prod | Una alla volta, con rollback plan |
| 10.4 | Vercel deploy da `miraxgroupckb` | |

---

## Fuori MIRAX — non implementare nel duplicato

Questi si collegano via **API / webhook / NOUS**, non come codice nel repo.

| Sistema | Ruolo | Integrazione |
|---------|-------|--------------|
| **Prosper** (TeknoBuild) | Project / document / cost | API bidirezionale |
| **Telmar Evolution** | Call center, geodialing | Riceve Pipeline Objects |
| **Salesforce** (istanza cliente) | CRM enterprise | Connector in MIRAX; SF resta esterno |
| **SHEE** | Decision AI / BI | API dati lead |
| **Jarvis / Mnemo** | Grafo semantico memoria org | API feed |
| **Know-Out Generazionale** | Consulenza passaggio impresa | Processo + tool; non solo SaaS |
| **Common Partnership platform** | Ecosistema multi-tenant partner | MIRAX v3+ / prodotto separato |
| **Zapier app ufficiale** | Marketplace | Repo Zapier CLI separato |
| **Salesforce AppExchange** | Package certificato | Repo SF separato |
| **OpenClaw + Ollama** | Agente outreach locale | Runtime separato (PC / cloud) |
| **CKB Desktop / Holon legacy** | Software storico Jonata | Fuori dal SaaS |
| **NERPHE / EU scale 2030** | Visione enterprise | 12–24 mesi, team dedicato |

---

## Timeline indicativa (solo tecnico)

| Fase | Periodo | Contenuto |
|------|---------|-----------|
| **Infra** | Settimana 1–2 | Blocco 0 |
| **Stabilità** | Settimana 2–4 | Blocco 1 + test E2E |
| **Core** | Mese 1–2 | Blocco 2 + 3.1 (cron 30gg) |
| **Pipeline / CKB objects** | Mese 2–4 | Blocchi 4–5 |
| **Intelligence** | Mese 4–9 | Blocchi 6–8 |
| **Enterprise** | Mese 6–12 | Blocco 7 (Salesforce, API) |
| **Promote** | Continuo | Blocco 10 per ogni pacchetto testato |

---

## Cosa è già fatto (non rifare)

- Motore lead generation (Maps + audit + score + pitch)
- Liste, merge, ambienti (base Giuseppe)
- Centro Outreach + Agente Campagna AI
- SemanticMap UI (manca solo dati reali — task 5.4)
- Billing Stripe/PayPal
- HubSpot + webhook base

---

## Cosa NON è in questa roadmap

- Landing MIRAX SaaS (`src/components/landing/`, copy, hero, sezioni marketing)
- Sito corporate CKB / MIRAX GROUP (timeline, 8 prodotti, visione 2030 come pagine)
- Redesign visivo Stripe-style o simili

→ **Simone li fa manualmente alla fine.**

---

*Ultimo aggiornamento: giugno 2026 — workspace `WEB APP CKB - Dev` / `ecosistema-mirax`*
