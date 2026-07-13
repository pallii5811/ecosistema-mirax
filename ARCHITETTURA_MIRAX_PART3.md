# MIRAX CKB — Architettura Completa (Parte 3/3)

## 7. Librerie di Enrichment (`src/lib/`)

### `clay-enrichment.ts` — Orchestratore principale
Combina TUTTE le fonti in un unico `ClayEnrichedLead`. Flusso:
1. Estrae dominio dal sito
2. Controlla cache `leads_cache` (90gg validità)
3. Esegue in parallelo:
   - `enrichFromPublicSources()` → LinkedIn, social, PEC, Google info
   - `fetchGoogleReviews()` + `analyzeReviewsWithAI()` → recensioni
   - `analyzeLocalCompetitors()` → competitor locali
   - `analyzeAdsPresence()` → Facebook/Google Ads
   - `analyzeTrends()` → Google Trends (pytrends o GPT fallback)
   - `analyzeSocialPresence()` → analisi social AI
   - `analyzeRegistry()` → stima dati camerali AI
4. Salva in cache `leads_cache`
5. Trigger webhook se configurato

### `public-enrichment.ts` — Fonti pubbliche gratuite
- **Google Search scraping**: cerca `site:linkedin.com/company/`, `site:linkedin.com/in/`, social
- **INIPEC**: cerca PEC su inipec.gov.it
- **Google info**: snippet e descrizioni dai risultati di ricerca
- Tutte le ricerche eseguite in parallelo con `Promise.allSettled`

### `apollo-enrichment.ts` — Apollo.io API
- `apolloPeopleSearch()`: cerca persone per titolo + location + azienda
- `apolloEnrichPerson()`: match per email o LinkedIn URL
- `apolloEnrichCompany()`: dati aziendali da dominio
- `apolloFindColleagues()`: colleghi nella stessa azienda
- Richiede `APOLLO_API_KEY`

### `snov-enrichment.ts` — Snov.io API
- `snovDatabaseSearch()`: cerca prospect per posizione + location
- `snovDomainSearch()`: tutte le email di un dominio
- `snovEmailFinder()`: trova email da nome + dominio
- `snovVerifyEmail()`: verifica validità email
- `snovGetProspect()`: profilo completo da email
- Richiede `SNOV_CLIENT_ID` + `SNOV_CLIENT_SECRET` (OAuth2)

### `google-reviews.ts` — Recensioni Google
- `fetchGoogleReviews()`: Google Places API → recensioni + rating
- `analyzeReviewsWithAI()`: GPT-4o-mini analizza sentiment, temi positivi/negativi, opportunità
- Richiede `GOOGLE_PLACES_API_KEY`

### `competitor-analysis.ts` — Analisi competitor
- `analyzeLocalCompetitors()`: Google Places text search → competitor locali
- GPT-4o-mini produce: competition score, market position, opportunità, urgency message
- Richiede `GOOGLE_PLACES_API_KEY` + `ANTHROPIC_API_KEY`

### `ads-analysis.ts` — Analisi advertising
- `analyzeAdsPresence()`: Facebook Ads Library API (gratuita) + GPT per Google Ads
- Produce: stato ads, budget stimato, opportunità commerciali
- Richiede `FB_ADS_TOKEN` (opzionale) + `ANTHROPIC_API_KEY`

### `trends-analysis.ts` — Trend di mercato
- `analyzeTrends()`: prima prova backend Hetzner (`/trends-analysis` con pytrends)
- Fallback: GPT-4o-mini con conoscenza mercato italiano
- Produce: trend (growing/stable/declining), growth %, peak months, best contact time

### `social-analysis.ts` — Presenza social
- `analyzeSocialPresence()`: GPT-4o-mini stima presenza social
- Produce: score 0-100, piattaforme mancanti, piattaforme inattive, opportunità

### `registry-analysis.ts` — Dati camerali stimati
- `analyzeRegistry()`: GPT-4o-mini stima anno fondazione, forma giuridica, dipendenti, fatturato
- Basato su conoscenza generale, non dati reali (usa `null` se incerto)

### `webhook.ts` — Invio webhook
```typescript
sendToWebhook({ webhookUrl, payload, timeoutMs: 6000 })
// POST JSON con User-Agent: MIRAX/1.0, timeout 6s
```

### `resend.ts` — Email
```typescript
export const resend = new Resend(process.env.RESEND_API_KEY)
```

### `utils.ts` — Utility
```typescript
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```

---

## 8. Variabili d'Ambiente Richieste

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://rtjmnjromqpsfqsgyfvp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_oqwwYsG10z7HvPrJOifF-w_J7ARllCp
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...

# OpenAI (per enrichment AI)
ANTHROPIC_API_KEY=sk-...

# Google APIs
GOOGLE_PLACES_API_KEY=...
FB_ADS_TOKEN=...           # opzionale

# Backend Hetzner
BACKEND_URL=http://116.203.137.39:8001

# API esterne (opzionali)
APOLLO_API_KEY=...
SNOV_CLIENT_ID=...
SNOV_CLIENT_SECRET=...
RESEND_API_KEY=...
```

---

## 9. Sistema Webhook

### Configurazione
- Utente registra URL webhook da `/dashboard/settings`
- Seleziona eventi: `lead.enriched`, `search.completed`, `pipeline.updated`
- Salvato in `user_webhooks`

### Trigger
- Dopo `clayEnrichLead()`: se lead arricchito con successo → `POST /api/webhooks/test` con payload `{ event, lead, timestamp }`
- Timeout: 6 secondi, fire-and-forget (non blocca la response)

### Payload esempio
```json
{
  "event": "lead.enriched",
  "lead": { /* ClayEnrichedLead */ },
  "timestamp": "2026-01-15T10:30:00Z"
}
```

---

## 10. Sistema Crediti

- Utente free: 10 crediti
- Ogni ricerca consuma 1 credito
- API `/api/search` decrementa `profiles.credits`
- Se crediti = 0, ricerca bloccata
- Admin può ricaricare crediti

---

## 11. Re-Audit System

### Cosa fa
Periodicamente ri-analizza i siti web dei lead esistenti per rilevare cambiamenti.

### Trigger
- `GET /api/cron/reaudit` (chiamato da Vercel Cron)
- `python worker_supabase.py --reaudit --reaudit-max 20`

### Flusso
1. Seleziona lead da `lead_pipeline` ordinati per `updated_at` ASC
2. Per ognuno: ri-esegue `audit_website_with_status()`
3. Confronta con dati precedenti via `_detect_changes()`
4. Se cambiamenti rilevati → aggiorna `lead_data` in `lead_pipeline`
5. Logga cambiamenti

### Campi monitorati per changes
- Meta Pixel, GTM, Instagram, Facebook, Sito Web, Email, Rating Google

---

## 12. API Insights AI (`/api/insights/ai`)

### Funzionamento
1. Aggrega dati pipeline utente (nessun PII inviato a OpenAI)
2. Calcola: total deals, won/lost, win rate, revenue, avg deal size, stagnant count, top categories, stage distribution
3. Invia summary aggregato a GPT-4o-mini
4. Riceve 3-5 insight con: icon, title, body, severity
5. Fallback offline se OpenAI non risponde

### Tipi di insight
- **win**: win rate > 40%
- **risk**: win rate < 20%, deal stagnanti
- **opportunity**: categorie top-performing
- **trend**: metriche di crescita
- **focus**: suggerimenti generici

### Severity
- `success`: metriche positive
- `warning`: aree di attenzione
- `critical`: rischi immediati
- `info`: neutro

---

## 13. Admin Panel (`/dashboard/admin`)

Accessibile solo a utenti con `profiles.plan_type = 'admin'`.

### Funzionalità
- Statistiche globali: utenti totali, ricerche totali, lead in pipeline
- Gestione utenti: ricarica crediti, cambia piano
- Log ultime ricerche

### API: `GET /api/admin/stats`
```json
{
  "totalUsers": 42,
  "totalSearches": 156,
  "totalPipelineLeads": 89,
  "recentSearches": [...]
}
```

---

## 14. Backend Hetzner — Endpoints Aggiuntivi

Il backend Python su Hetzner (porta 8001) espone anche:

| Endpoint | Descrizione |
|---|---|
| `POST /trends-analysis` | Google Trends via pytrends |
| `POST /scrape` | Scraping Google Maps on-demand |
| `GET /health` | Health check |

Il worker principale (`worker_supabase.py`) NON usa questi endpoint — chiama direttamente le funzioni Python internamente.

---

## 15. Riepilogo Flussi Dati

```
GOOGLE MAPS (Playwright)
  ↓
worker_supabase.py → searches.results (JSONB)
  ↓
Frontend /dashboard (tabella lead)
  ↓
Click lead → /dashboard/lead/[id]
  ↓
POST /api/enrich-lead → clayEnrichLead()
  ↓
  ├── Google Search scraping → LinkedIn, social, PEC
  ├── Google Places API → recensioni
  ├── Google Places API → competitor
  ├── Facebook Ads Library → ads
  ├── GPT-4o-mini → competitor analysis, ads analysis, social analysis, registry, trends
  └── Cache in leads_cache (90gg)
  ↓
ClayEnrichedLead mostrato in UI
  ↓
"Aggiungi a Pipeline" → POST /api/pipeline → lead_pipeline
  ↓
/dashboard/pipeline → kanban (nuovo → contattato → trattativa → vinto/perso)
  ↓
/dashboard/insights → GET /api/insights/ai → GPT-4o-mini analizza pipeline
```
