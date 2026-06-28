# MIRAX — Brief di implementazione per Cursor (v1.0)

**Destinatario:** Agent Cursor / sviluppatore  
**Repo:** `pallii5811/ecosistema-mirax`  
**Cartella locale:** `WEB APP CKB - Dev`  
**Deploy app:** Vercel → `ecosistema-mirax.vercel.app`  
**Worker/API:** Hetzner **116** staging `:8002` (Supabase dev `ktspchugdwpqvxhmysap`)  
**Produzione legacy (NON TOCCARE):** `WEB APP CKB - Copia` → miraxgroup.it, server **178**

---

## 0. Come usare questo documento (obbligatorio per Cursor)

1. **Leggi l’intero §1–§3** prima di scrivere codice.  
2. **Implementa UNA fase alla volta** (§5). Non mescolare Fase 1 e Fase 3 nello stesso PR.  
3. **Riusa** ciò che esiste (§2). Non duplicare logiche già in `buyingSignals.ts`, `search-cache.ts`, `openapi-service.ts`.  
4. **Human-in-the-loop sempre** su outreach email/WhatsApp — niente invii autonomi senza click utente.  
5. **Test obbligatori** per ogni fase: `npm run build` + script in §8.  
6. **Deploy:** Vercel per frontend/API Next.js; worker solo su **116** via `backend_mirror/scripts/deploy-staging.sh`.  
7. **Feature flag:** Centro Comando nascosto (`src/lib/feature-flags.ts`) — non riattivare senza richiesta esplicita.

**Definition of Done globale (ogni task):**
- TypeScript strict: 0 errori build  
- Nessuna regressione ricerca Maps / crediti / cache (`search-cache.ts`)  
- Copy UI in **italiano**, tono professionale B2B  
- Dati lead: mai inventare email/telefono; segnali con `evidence[]` e `source`  
- GDPR: opt-in documentato, no scraping dati personali non pubblici

---

## 1. Posizionamento prodotto (sintesi strategica)

### 1.1 Tre categorie di mercato

| Categoria | Esempi | Limite |
|-----------|--------|--------|
| Scraping grezzo | Apollo, Lusha | Liste fredde, no contesto |
| Email marketing | Instantly, Smartlead | Invio massivo, no audit |
| **Segnale + Audit + Azione** | **MIRAX (target)** | Unico flusso end-to-end |

### 1.2 Vantaggio strutturale MIRAX (da comunicare in prodotto)

- **Segnale tecnico** (Pixel, GTM, SSL, SEO) — già presente via worker + audit  
- **Segnale business** (assunzioni, ads attive, cambi registro) — **da estendere Fase 1**  
- **Azione** (outreach, pipeline, CRM) — parzialmente presente  
- **GDPR EU** — server EU, fonti pubbliche, legittimo interesse — **da esplicitare Fase 1**

### 1.3 Cosa NON fare (vietato in v1)

| Feature | Motivo |
|---------|--------|
| Acquisto automatico domini per deliverability | Legale/ops complesso |
| Voice AI telefonica (11x.ai style) | Fuori core |
| Agenti fully autonomous su email/LinkedIn | Rischio legale/reputazionale |
| Multi-agent autonomi senza approvazione umana | Violazione principio HITL |
| Refactor totale UI in “hub Ecosistema” separato | Prodotto = tutta l’app, non una pagina |

---

## 2. Inventario codebase (stato attuale — NON riscrivere)

### 2.1 Stack

| Layer | Path | Ruolo |
|-------|------|-------|
| Frontend | `src/app`, `src/components` | Next.js 16 App Router |
| API BFF | `src/app/api/**` | Supabase, trigger scrape, CRM, outreach |
| Worker scraper | `backend_mirror/worker_supabase.py` | Job `searches`, Maps, audit |
| Scraper core | `backend_mirror/main.py` | Playwright Maps |
| Audit | `backend_mirror/audit_engine.py` | Audit tecnico siti |
| DB | Supabase + `db/migrations/` | Postgres |

### 2.2 File critici già funzionanti (toccare con cautela)

| File | Funzione |
|------|----------|
| `src/lib/search-cache.ts` | Cache categoria+città, merge job, incremental scrape |
| `src/lib/search-job-payload.ts` | `MAX_LEADS_PER_SEARCH = 500` |
| `src/components/DashboardShell.tsx` | Ricerca, polling, crediti, lista lead |
| `src/components/SniperArea.tsx` | Input ricerca, max lead |
| `src/utils/buyingSignals.ts` | **Motore segnali d’acquisto** (tech + meta ads) |
| `src/lib/lead-object.ts` | Schema lead v2 in `searches.results` |
| `src/lib/openapi-service.ts` | OpenAPI.it Camera Commercio |
| `src/app/api/trigger-scrape/route.ts` | Accoda job worker |
| `src/app/api/openapi-unlock/route.ts` | Arricchimento registro |
| `src/lib/outreach.ts` + `src/app/api/outreach/**` | Log outreach, guardrail |
| `src/app/api/compliance/**` | Audit trail AI (base compliance) |
| `src/lib/feature-flags.ts` | `SHOW_CENTRO_COMANDO` |

### 2.3 Segnali già implementati (`buyingSignals.ts`)

Estendere, **non duplicare**:
- Categorie: `budget`, `tracking`, `conversion`, `competition`, `reputation`, `company_fit`, `contactability`
- Meta Ad Library (`activeMetaAds`, `metaAdsVerified`) — già previsto nel tipo `BuyingSignalAudit`
- Score aggregato + `openingLine`, `nextBestAction`, `quantifiedImpact` con benchmark citabili

### 2.4 Gap rispetto al brief Gemini

| Capabilità | Stato | Fase |
|------------|-------|------|
| Business events (Indeed, OpenAPI delta, sito stale) | Parziale / mancante | 1 |
| Badge GDPR + Registro Opposizioni | Mancante | 1 |
| Dual-Mode UX (Expert / Discovery) | Mancante | 2 |
| Intent “sta investendo in marketing” unificato | Parziale | 2 |
| AI SDR (classifica risposte email) | Mancante | 3 |
| Deliverability nativa (SPF/DKIM/warmup) | Mancante | 4 |
| i18n Spagna | Mancante | 4 |

---

## 3. Architettura dati proposta (nuove tabelle)

### 3.1 `lead_business_signals` (Fase 1)

```sql
-- db/migrations/2026_07_01_lead_business_signals.sql
create table if not exists public.lead_business_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  lead_website text not null,
  lead_name text,
  signal_type text not null check (signal_type in (
    'hiring', 'new_location', 'registry_change', 'funding_news',
    'site_stale', 'meta_ads_started', 'google_ads_started'
  )),
  title text not null,
  severity text not null check (severity in ('critical', 'high', 'medium')),
  confidence smallint not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]',
  source text not null, -- es. 'indeed_scrape', 'openapi_it', 'meta_ad_library'
  detected_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, lead_website, signal_type, title)
);
create index if not exists idx_lbs_user_website on public.lead_business_signals(user_id, lead_website);
```

### 3.2 `compliance_checks` (Fase 1 — GDPR)

```sql
-- db/migrations/2026_07_01_compliance_checks.sql
create table if not exists public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'phone', 'whatsapp')),
  target text not null, -- email o telefono normalizzato
  check_type text not null check (check_type in ('registro_opposizioni', 'gdpr_basis_logged')),
  status text not null check (status in ('clear', 'blocked', 'unknown', 'manual_review')),
  raw_response jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists idx_compliance_target on public.compliance_checks(user_id, target, check_type);
```

### 3.3 `inbound_reply_classifications` (Fase 3 — AI SDR MVP)

```sql
-- db/migrations/2026_09_01_inbound_reply_classifications.sql
create table if not exists public.inbound_reply_classifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outreach_log_id uuid references public.outreach_log(id) on delete set null,
  reply_snippet text not null,
  intent text not null check (intent in ('interested', 'not_now', 'not_interested', 'wrong_person', 'unsubscribe', 'unknown')),
  suggested_action text not null,
  follow_up_at timestamptz,
  model text,
  created_at timestamptz not null default now()
);
```

---

## 4. Modello unificato segnali (contratto TypeScript)

**File canonico:** estendere `src/utils/buyingSignals.ts` + nuovo `src/lib/business-events.ts`

```typescript
// Nuovo tipo unificato — NON breaking change su BuyingSignal
export type MiraxSignalKind = 'technical' | 'business' | 'intent' | 'compliance'

export type MiraxSignal = {
  id: string
  kind: MiraxSignalKind
  title: string
  severity: 'critical' | 'high' | 'medium'
  confidence: number // 0-100
  reason: string
  evidence: { label: string; value: string; source: string; url?: string }[]
  serviceToSell?: string
  openingLine?: string
  nextBestAction?: string
  detectedAt?: string
}
```

**Regola:** ogni segnale mostrato in UI deve avere almeno 1 `evidence` con `source` verificabile.

---

## 5. Roadmap di implementazione (sequenza obbligatoria)

### FASE 1 — Settimane 1–4 (PRIORITÀ MASSIMA)

#### F1-A — Business Events Signals

**Obiettivo utente:** filtrare e aprire lead con motivo commerciale oltre al “manca il Pixel”.

**Implementazione tecnica:**

| # | Task | File / modulo | Dettaglio |
|---|------|---------------|-----------|
| 1 | Modulo raccolta eventi | `src/lib/business-events/` | `collectBusinessEvents(lead): Promise<MiraxSignal[]>` |
| 2 | Indeed hiring (IT) | `src/lib/business-events/indeed.ts` | Playwright worker-side OR server API route; query `{azienda} {città}`; max 3 offerte; estrarre titolo + data |
| 3 | OpenAPI delta | `src/lib/business-events/registry-delta.ts` | Usa `openapi-service.ts`; confronta snapshot P.IVA vs cache (`company_lookup_cache` se esiste) |
| 4 | Site stale | `src/lib/business-events/site-stale.ts` | `last-modified` header, copyright footer year, `sitemap.xml` lastmod |
| 5 | Meta ads (intent) | Riusa audit + `buyingSignals.ts` | Popolare `activeMetaAds` via worker o route dedicata |
| 6 | Persistenza | migration §3.1 | Salva su enrich lead / dettaglio |
| 7 | Worker batch (opz.) | `backend_mirror/worker_supabase.py` | Flag env `ENRICH_BUSINESS_EVENTS=1`; non bloccare job Maps |
| 8 | UI filtro ricerca | `src/components/SniperArea.tsx` | Multi-select “Segnale business” (Hiring, Ads attive, Sito datato, …) |
| 9 | UI lead | `src/components/ResultsTable.tsx`, dettaglio lead | Badge segnale + tooltip evidence |
| 10 | API | `src/app/api/lead/business-events/route.ts` | GET per lead; POST refresh on-demand (1 credito?) |

**Acceptance criteria F1-A:**
- [ ] Lead Milano edili: almeno 1 segnale business su campione 10 con sito noto  
- [ ] Nessun segnale senza `evidence`  
- [ ] Filtro ricerca riduce lista senza rompere cache  
- [ ] Worker non OOM su 116 (1 browser, cooldown, `--disable-dev-shm-usage` già in main.py)

---

#### F1-B — GDPR come feature prodotto

**Obiettivo utente:** badge “GDPR Verified” e blocco outreach se in Registro Opposizioni.

| # | Task | File | Dettaglio |
|---|------|------|-----------|
| 1 | Check Registro Opposizioni | `src/lib/compliance/registro-opposizioni.ts` | Integrazione servizio autorizzato o scraping controllato documentato; fallback `manual_review` |
| 2 | Hook pre-outreach | `src/lib/outreach.ts` | Prima di `window.open` email/tel: chiamata check; se `blocked` → modal |
| 3 | Badge lead | `src/components/LeadComplianceBadge.tsx` | Stati: `verified`, `blocked`, `unknown` |
| 4 | Pagina trust | `src/app/dashboard/compliance/page.tsx` | “Il tool più sicuro per l’outreach B2B in EU” — testi + log check |
| 5 | Log | migration §3.2 | Ogni check persistito |
| 6 | AI Act trail | estendi `src/lib/ai-act-audit.ts` | Log “legittimo interesse” quando utente conferma outreach |

**Acceptance criteria F1-B:**
- [ ] Outreach bloccato con messaggio chiaro se target in opposizioni (test con mock)  
- [ ] Badge visibile in tabella risultati  
- [ ] Pagina compliance linkata da Integrazioni o Profilo  
- [ ] Nessun dato personale extra salvato oltre target contattato + esito check

---

### FASE 2 — Settimane 5–8

#### F2-A — Dual-Mode UX (Expert + Discovery)

**Obiettivo:** imprenditori non tecnici vedono “Nome azienda → Motivo → Pitch”, non “MISSING GTM”.

| Modalità | Pubblico | UI Ricerca | Output |
|----------|----------|------------|--------|
| **Expert** (default attuale) | Agenzie, marketer | Filtri tech, tech_stack, audit | Invariato |
| **Discovery** | Imprenditori generalisti | “Cosa vendi?” + città + max lead | Card semplificate: Nome, Motivo contatto, Pitch 2 righe |

**Implementazione:**

| # | Task | File |
|---|------|------|
| 1 | Persistenza preferenza | `profiles.ui_mode` o `localStorage` key `mirax_ui_mode` |
| 2 | Toggle header | `src/components/TopHeader.tsx` o `SniperArea.tsx` |
| 3 | Wizard Discovery | `src/components/discovery/DiscoverySearchWizard.tsx` |
| 4 | Mapping intent → categoria | `src/lib/discovery-intent-map.ts` | LLM leggero o mappa statica IT |
| 5 | Card risultati Discovery | `src/components/discovery/DiscoveryLeadCard.tsx` | Usa `buyingSignals` → `openingLine` |
| 6 | Onboarding first-run | `src/components/onboarding/FirstRunModal.tsx` | Scelta modalità |

**Acceptance criteria F2-A:**
- [ ] Toggle Expert/Discovery senza perdere sessione ricerca  
- [ ] Discovery non mostra jargon (`MISSING FB PIXEL`) — sostituisce con copy umano  
- [ ] Expert mode identico al comportamento pre-refactor

---

#### F2-B — Intent Data “Sta investendo in marketing”

Unificare in un unico segnale `intent_marketing_spend`:
- Meta ads attive (Ad Library)  
- Google ads tag presente / assente con traffico stimato (se disponibile)  
- Recent website redesign (site-stale inverse + performance delta)

**File:** estensione `buyingSignals.ts` + badge “Investitore marketing” in `ResultsTable`.

---

### FASE 3 — Settimane 9–12

#### F3-A — AI SDR MVP (suggest-only, HITL)

**NON** risposta automatica. Flusso:

1. Utente registra outreach in `outreach_log` (esiste)  
2. Utente incolla risposta email OR forward futuro → `POST /api/outreach/classify-reply`  
3. Claude API classifica `intent` + `suggested_action` + `follow_up_at` opzionale  
4. UI in `src/app/dashboard/outreach/page.tsx`: card “Risposta ricevuta” con 3 bottoni (Accetta suggerimento / Modifica / Ignora)

**Env:** `ANTHROPIC_API_KEY` o provider già usato in `src/app/api/insights/ai/route.ts`

**Acceptance criteria F3-A:**
- [ ] Classificazione su 5 email fixture test  
- [ ] Nessun invio email automatico  
- [ ] Log in `inbound_reply_classifications` + `ai-act-audit`

---

### FASE 4 — Mesi 4–6 (backlog)

| ID | Feature | Note |
|----|---------|------|
| F4-A | Deliverability base | Integrazione Resend/Mailgun; SPF/DKIM guide; NO auto-buy domini |
| F4-B | Jarvis ↔ MIRAX | API v1 esistente `src/app/api/v1/**` |
| F4-C | Espansione ES | i18n + Maps query ES; worker location già supporta città |
| F4-D | Seamless Inbox | OAuth Gmail read-only + classificazione F3 |

---

## 6. UX copy guidelines (qualità 10/10)

### 6.1 Discovery mode — esempi copy

| ❌ Expert (jargon) | ✅ Discovery |
|-------------------|---------------|
| MISSING FB PIXEL | Non traccia i visitatori — perdi soldi sugli annunci |
| DISASTRO SEO | Il sito è invisibile su Google |
| NO GTM | Non misura da dove arrivano i clienti |

### 6.2 GDPR badge

- **Verified:** “Contatto consentito — fonte pubblica, base giuridica documentata”  
- **Blocked:** “In Registro Opposizioni — outreach non disponibile”  
- **Unknown:** “Verifica consigliata prima del primo contatto”

### 6.3 Empty states

Mai “0 risultati” senza spiegazione. Usare `formatSearchProgressMessage()` in `search-contact-quality.ts`.

---

## 7. Integrazione worker (116 staging)

**Deploy:** `backend_mirror/scripts/deploy-staging.sh` (root SSH)

**Regole worker:**
- `--user-recent-minutes 0` obbligatorio (bug fix: `0 or 10` → usare `None` check)  
- Max **1 worker staging** su 116 (4GB RAM)  
- Business events: thread separato post-scrape, non bloccare publish risultati Maps  
- Preservare risultati su re-scrape: merge `_rt_results` (già in worker)

**Env staging suggeriti:**
```
ENRICH_BUSINESS_EVENTS=1
ENRICH_REVIEWS=0
FB_ADS_TOKEN=...   # opzionale, per meta ads verified
OPENAPI_API_KEY=...
```

---

## 8. Test plan (obbligatorio per ogni PR)

```bash
cd "WEB APP CKB - Dev"
npm run build
npm run test:ecosistema          # se disponibile
node scripts/test-search-cache.mjs
node scripts/check-worker-health.mjs
# Dopo F1-A:
node scripts/test-business-events.mjs   # da creare
# Dopo F1-B:
node scripts/test-compliance-opposizioni.mjs   # da creare con mock
```

**E2E manuale minimo:**
1. Login `ecosistema-mirax.vercel.app`  
2. Ricerca “imprese edili Milano” max 10 lead  
3. Verifica badge segnale + GDPR su almeno 1 lead  
4. Tentativo outreach → check compliance

---

## 9. Ordine PR consigliato (per Cursor)

| PR | Scope | Stima |
|----|-------|-------|
| PR-1 | Migration `lead_business_signals` + `business-events` lib + API route | 3–5 gg |
| PR-2 | UI filtri + badge segnali business | 2–3 gg |
| PR-3 | Worker enrich opzionale Indeed/site-stale | 3–4 gg |
| PR-4 | Compliance Registro Opposizioni + badge + hook outreach | 4–5 gg |
| PR-5 | Pagina `/dashboard/compliance` | 1–2 gg |
| PR-6 | Dual-Mode UX Discovery | 5–7 gg |
| PR-7 | AI SDR classify-reply MVP | 5–8 gg |

**Un PR = una review. No monolite.**

---

## 10. Prompt operativo per Cursor (copia-incolla)

```
Implementa SOLO la Fase 1-A del file docs/CURSOR_IMPLEMENTATION_BRIEF_MIRAX_V1.md.

Vincoli:
- Repo: WEB APP CKB - Dev (ecosistema-mirax)
- Estendi buyingSignals.ts e crea src/lib/business-events/
- Non toccare WEB APP CKB - Copia
- Non riattivare Centro Comando (feature-flags)
- Human-in-the-loop su outreach
- Ogni segnale con evidence[] e source
- npm run build deve passare
- Aggiungi scripts/test-business-events.mjs

Al termine: elenco file modificati, come testare, cosa deployare su Vercel vs 116.
```

---

## 11. Metriche di successo (post-lancio Fase 1)

| Metrica | Target |
|---------|--------|
| % lead con ≥1 segnale business | > 40% su ricerche edili/servizi locali |
| Tempo medio a primo outreach | -20% vs baseline |
| Bounce outreach per compliance block | misurabile, < 5% falsi positivi |
| NPS copy Discovery (qualitativo) | “Capisco perché contattare” su 8/10 utenti test |

---

## 12. Riferimenti interni

- `docs/SCORE_AI_RULES.md` — scoring lead  
- `docs/BLOCCO0_SETUP.md` — infra dev  
- `ECOSISTEMA_ROADMAP.md` — blocchi 1–9 già completati parzialmente  
- `src/utils/buyingSignals.ts` — motore segnali attuale  
- `src/lib/search-cache.ts` — non rompere merge cache  

---

*Documento generato per implementazione Cursor — MIRAX v1.0 — Giugno 2026*
