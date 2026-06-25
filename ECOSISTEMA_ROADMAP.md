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
| 0.1 | Progetto **Supabase dev** separato | Mai riusare `rtjmnjromqpsfqsgyfvp` | ⬜ |
| 0.2 | Eseguire tutte le migration | `db/migrations/*.sql` sul progetto dev | ⬜ |
| 0.3 | `.env.local` in Dev | Da `.env.staging.example`; chiavi solo dev | ⬜ |
| 0.4 | API staging su **116:8002** | `mirax-audit-api-staging.service` | ⬜ |
| 0.5 | Worker staging (1–2 istanze) | Stesso codice, `.env` → Supabase dev | ⬜ |
| 0.6 | `BACKEND_URL` dev | `http://116.203.137.39:8002` | ⬜ |
| 0.7 | Vercel preview | Progetto collegato a `ecosistema-mirax` | ⬜ |
| 0.8 | Regola operativa | Mai deploy worker su **178** senza test su **116:8002** | ⚠️ sempre |

---

### Blocco 1 — Stabilità ricerca e worker (priorità massima)

Bug reali emersi in produzione (es. Benevento). Da fare per primi sul duplicato.

| # | Task | Dove | Note |
|---|------|------|------|
| 1.1 | **Mercato esaurito** — stop spinner quando Maps non aggiunge lead | `src/components/DashboardShell.tsx` | Plateau conteggio + job ancora `processing` |
| 1.2 | Trasparenza contatti | `DashboardShell.tsx` | Es. "43 trovati, 35 con contatto, 8 nascosti" (`_hasContact`) |
| 1.3 | Worker: non bloccare job su **reviews_scraper** | `backend_mirror/worker_supabase.py` | Timeout 30s × N lead → 20+ min inutili |
| 1.4 | `completed` quando Maps esaurito | `worker_supabase.py` | Anche con audit leggeri ancora pending |
| 1.5 | Fix merge audit (preferire versione completa) | `worker_supabase.py` `_merge_formatted_results` | Evita "Audit in arrivo" bloccato |
| 1.6 | Instagram / social su audit API | `process_single_url`, route audit `:8001` | Oggi `missing_instagram` hardcoded false |
| 1.7 | Test E2E staging | Benevento + altra città piccola/grande | Prima di qualsiasi promote a prod |

---

### Blocco 2 — Core prodotto (Lead Generation Engine)

Il motore **esiste già**. Qui si consolida e si chiude il gap tra prodotto reale e promesse tecniche (non landing).

| # | Task | Dove | Note |
|---|------|------|------|
| 2.1 | Audit sito più veloce e affidabile | `audit_engine.py`, `resume-audits`, worker | Pixel, SSL, GTM, speed, social |
| 2.2 | Score AI: documentare rule-based vs ML | `worker_supabase._calc_opportunity_score`, `leadIntelligence.ts` | Nessun ML addestrato oggi |
| 2.3 | Schema Lead Object consolidato | `db/migrations/`, normalizzazione JSON lead | Versioning, campi stabili |
| 2.4 | `freshness_score` su lead | migration + worker + UI | Base per re-audit |
| 2.5 | Migration **`zone`** su `searches` | `db/migrations/2026_06_23_searches_zone.sql` | Solo su Supabase **dev** prima; poi prod con test |
| 2.6 | `trigger-scrape` allineato a `zone` | `src/app/api/trigger-scrape/route.ts` | Dopo migration applicata |
| 2.7 | Verifica fix **ambienti** (stats dopo attach lista) | `src/app/dashboard/environments/actions.ts` | Già in prod parzialmente — validare su dev |
| 2.8 | Crediti e billing invariati | Stripe/PayPal routes | Nessun refactor se non necessario |

---

### Blocco 3 — EDAT lite (Event Driven Action Time)

Implementabile nel monorepo senza prodotto separato.

| # | Task | Dove | Note |
|---|------|------|------|
| 3.1 | Cron **re-audit ogni 30 giorni** | `vercel.json` + `src/app/api/cron/reaudit` | Worker già capace di audit |
| 3.2 | Trigger su evento lead | `monitor-lead`, alerts, webhook outbound | Esistente parzialmente |
| 3.3 | Sequenze event-driven | `sequences-dispatch` cron, `OutreachLauncher` | Completare flusso |
| 3.4 | Tabella `events` + consumer | `db/migrations/`, `src/lib/events/` | Event bus interno (fase 2 EDAT) |
| 3.5 | "Cosa fare ora" operativo | `src/app/api/insights/actions` | Estendere insights esistenti |

---

### Blocco 4 — Pipeline e Self-Adjustment

| # | Task | Dove | Note |
|---|------|------|------|
| 4.1 | Outreach → **pipeline auto-sync** | `outreach_log`, `api/pipeline`, outreach page | Stato lead aggiornato da contatto |
| 4.2 | Score adattivo da conversioni | `scoring/actions.ts` + tabella esiti | Usa `outreach_log` + pipeline |
| 4.3 | Pipeline status flow completo | Kanban + outreach esiti | Allineare 6 stati concettuali CKB dove ha senso |
| 4.4 | Migration outreach su dev | `db/migrations/2026_06_22_outreach_log.sql` | Obbligatoria per tracciamento |

---

### Blocco 5 — Oggetti CKB (data model)

| Oggetto | Stato oggi | Task |
|---------|------------|------|
| **Lead Object** | ✅ Esiste | Consolidare schema (2.3) |
| **Scraping Object** | ✅ Esiste | `searches` + worker |
| **Pipeline Object** | ✅ Esiste | Blocco 4 |
| **Ambiente Object** | ⚠️ Parziale | SemanticMap con dati reali (5.4), auto-update ambienti |
| **Knowledge Object** | ❌ | Nuova tabella `knowledge_objects` + API + alimentazione da correlazioni |
| **Integration Object (NOUS)** | ❌ | `src/lib/nous/` — vedi Blocco 6 |

| # | Task | Dove |
|---|------|------|
| 5.1 | Tabella `knowledge_objects` | `db/migrations/` |
| 5.2 | API CRUD + query per ambiente | `src/app/api/knowledge/` |
| 5.3 | Alimentazione da lead chiusi / pattern | worker o cron + `outreach_log` |
| 5.4 | **SemanticMap** con dati reali (non solo UI) | `SemanticMap.tsx` + API graph |
| 5.5 | **pgvector** su lead/knowledge | Supabase extension + migration |

---

### Blocco 6 — Cross-Meshing / Value Relations / PKI (versione MIRAX)

Non è "AI emergente magica": motore di correlazione + analytics.

| # | Task | Dove | Note |
|---|------|------|------|
| 6.1 | Correlazione lead per ambiente | Query Supabase + aggregazioni | |
| 6.2 | Pattern chiusura (badge → conversione) | `outreach_log` + `pipeline` analytics | |
| 6.3 | API **PKI** (Performance Analysis Indicator) | `src/app/api/insights/pki` | Nuovo |
| 6.4 | Smart Insights con metriche reali | `insights/ai`, `insights/stats` | Niente numeri mock |
| 6.5 | Vector search (CKBase-lite) | pgvector + retrieval API | |

---

### Blocco 7 — Integrazioni (layer NOUS)

| # | Task | Dove | Stato |
|---|------|------|-------|
| 7.1 | Struttura `src/lib/nous/` | `adapters/`, `normalizer.ts`, `dispatcher.ts` | ⬜ |
| 7.2 | HubSpot | già presente | ✅ mantenere |
| 7.3 | Webhook generico (Zapier/Make) | `api/crm/webhook` | ✅ espandere eventi |
| 7.4 | REST API v1 enterprise | `api/v1/leads`, `api/v1/keys` | ⚠️ espandere |
| 7.5 | **Salesforce connector** | `api/crm/salesforce` + OAuth | ⬜ 1–2 mesi |
| 7.6 | MS Dynamics / vTiger | stesso pattern adapter | ⬜ futuro |
| 7.7 | MCP server MIRAX (opzionale) | package separato `mirax-mcp` | ⬜ opzionale |

---

### Blocco 8 — Multi-Agent pragmatico

Non serve swarm complesso subito. Agenti = servizi specializzati nel monorepo.

| Agente | Dove oggi | Task |
|--------|-----------|------|
| Search Agent | `actions.ts` | Consolidare NLP + hybrid search |
| Audit Agent | `worker_supabase.py` | Blocco 1–2 |
| Pitch Agent | `generatePitchAction` | ✅ |
| Outreach Agent | `CampaignAgent`, `outreach.ts` | ✅ estendere guardrail |
| Insights Agent | `insights/ai` | Collegare a PKI / Knowledge |
| Orchestrator | `DashboardShell`, `resume-audits` | Unificare in `src/lib/agents/` |

| # | Task | Dove |
|---|------|------|
| 8.1 | Modulo `src/lib/agents/` | orchestrator + registry agenti |
| 8.2 | (Opzionale) LangGraph / CrewAI | solo se serve orchestrazione complessa |

---

### Blocco 9 — Infrastruttura operativa

| # | Task | Dove |
|---|------|------|
| 9.1 | Deploy script worker staging → prod | `backend_mirror/` + checklist backup |
| 9.2 | Monitoring / log worker | journalctl + alert base |
| 9.3 | AI Act audit trail | `outreach_log`, `technical_report`, score motivation |
| 9.4 | Documentare confini API | aggiornare `ARCHITETTURA_MIRAX_V2_COMPLETA.md` |

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
