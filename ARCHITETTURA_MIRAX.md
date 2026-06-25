# MIRAX CKB — Architettura Completa

## Panoramica
MIRAX CKB è una web app Next.js 14 (App Router) per lead generation B2B. Cerca aziende italiane su Google Maps, le arricchisce con dati tecnici/demografici/social, le gestisce in pipeline CRM, e fornisce insight AI.

**Stack:** Next.js 14 + TypeScript + Tailwind CSS + Supabase (auth+DB) + Python worker (Playwright) + OpenAI GPT-4o-mini

| Componente | Dove | Porta |
|---|---|---|
| Next.js frontend | Vercel / localhost | 3000 |
| Python scraper | Hetzner VPS (116.203.137.39) | 8001 |
| Supabase | Cloud | — |

---

## 1. Database Supabase — Schema

### `searches` — Job di ricerca
```sql
id UUID PK DEFAULT gen_random_uuid()
user_id UUID FK auth.users(id)
status TEXT DEFAULT 'pending'   -- pending|processing|completed|error
category TEXT NOT NULL          -- es. "dentista"
location TEXT NOT NULL          -- es. "Milano"
zone TEXT                       -- opzionale
results JSONB                   -- array di lead arricchiti
created_at TIMESTAMPTZ DEFAULT now()
```

### `profiles` — Profili utente
```sql
id UUID PK FK auth.users(id)
email TEXT, full_name TEXT, company TEXT
credits INTEGER DEFAULT 10
plan_type TEXT DEFAULT 'free'   -- free|pro|enterprise
```

### `lead_pipeline` — Pipeline CRM
```sql
id UUID PK DEFAULT gen_random_uuid()
user_id UUID FK auth.users(id)
lead_name TEXT NOT NULL
lead_category TEXT, lead_city TEXT, lead_phone TEXT, lead_email TEXT, lead_website TEXT
lead_score INTEGER DEFAULT 0
lead_data JSONB                -- snapshot completo lead
stage TEXT DEFAULT 'nuovo'     -- nuovo|contattato|trattativa|vinto|perso
deal_value NUMERIC DEFAULT 0
notes TEXT DEFAULT ''
created_at, updated_at TIMESTAMPTZ
```

### `leads_cache` — Cache enrichment (90 giorni)
```sql
domain TEXT PK
data JSONB NOT NULL
updated_at TIMESTAMPTZ
```

### `user_webhooks` — Webhook
```sql
id UUID PK, user_id UUID FK, url TEXT, events TEXT[], is_active BOOLEAN, created_at TIMESTAMPTZ
```

### RLS Policies
- **searches**: SELECT/INSERT solo `user_id = auth.uid()`. Worker usa `SUPABASE_SERVICE_ROLE_KEY` per bypass.
- **profiles**: SELECT/UPDATE solo proprio profilo.
- **lead_pipeline**: CRUD solo proprie righe.
- **leads_cache**: SELECT pubblico, INSERT/UPDATE solo service_role.

### Auth
Supabase Auth (email/password + Google OAuth). Session cookie: `sb-rtjmnjromqpsfqsgyfvp-auth-token`.

---

## 2. Frontend — Pages

| Route | Descrizione | Auth |
|---|---|---|
| `/` | Landing page | No |
| `/login` | Login Supabase | No |
| `/dashboard` | Ricerca lead (form categoria+città) | Sì |
| `/dashboard/lead/[id]` | Dettaglio lead con enrichment | Sì |
| `/dashboard/pipeline` | Pipeline CRM kanban | Sì |
| `/dashboard/insights` | Insight AI + grafici | Sì |
| `/dashboard/settings` | Profilo + webhook | Sì |
| `/dashboard/admin` | Admin panel | Sì (admin) |

---

## 3. API Routes

| Route | Method | Descrizione |
|---|---|---|
| `/api/search` | POST | Crea job ricerca (scrive `searches`) |
| `/api/search/status` | GET | Polling stato job |
| `/api/search/history` | GET | Storico ricerche |
| `/api/enrich-lead` | POST | Arricchimento completo Clay-style |
| `/api/pipeline` | GET/POST/PUT/DELETE | CRUD pipeline |
| `/api/pipeline/stats` | GET | Statistiche pipeline |
| `/api/profile` | GET/PUT | Profilo utente |
| `/api/insights/ai` | GET | Insight AI da pipeline reale |
| `/api/webhooks` | GET/POST/DELETE | Gestione webhook |
| `/api/admin/stats` | GET | Statistiche globali |
| `/api/cron/reaudit` | GET | Trigger re-audit (Vercel Cron) |

---

## 4. Flusso Principale: Ricerca → Scraping → Risultati

```
1. Utente compila form su /dashboard: categoria + città → POST /api/search
2. API crea riga in searches (status=pending, user_id=X)
3. Worker Python (polling ogni 4s) rileva job pending
4. Worker fa claim atomico: UPDATE status=processing WHERE status=pending
5. Playwright apre Google Maps, cerca "categoria vicino a città"
6. Estrae 20 risultati (nome, indirizzo, telefono, sito, rating, recensioni)
7. Per ogni lead con sito web: audit tecnico (SSL, mobile, pixel, GTM, speed, etc.)
8. Arricchisce con recensioni Google + competitor locali (Playwright)
9. Worker scrive results JSONB in searches, status=completed
10. Frontend fa polling GET /api/search/status finché status != pending/processing
11. Risultati mostrati in tabella su /dashboard
```

---

## 5. Tipi TypeScript Fondamentali

### Lead (da Google Maps scraping)
```typescript
interface LeadResult {
  azienda: string
  telefono: string
  email: string | null
  sito: string | null
  website: string | null
  citta: string
  tech_stack: string[]
  rating: number | null
  reviews_count: number
  is_claimed: boolean | null
  instagram: string | null
  facebook: string | null
  meta_ads_library: string | null
  decision_maker: string
  meta_pixel: boolean
  google_tag_manager: boolean
  html_errors: number
  technical_report: TechnicalReport
  last_audited_at: string
  freshness_score: number
  opportunity_score: number
  audit_version: number
  google_reviews: GoogleReview[]
  local_competitors: LocalCompetitor[]
}
```

### TechnicalReport
```typescript
interface TechnicalReport {
  html_errors: number
  load_speed_s: number | null
  load_speed_seconds: number | null
  error_details: string[]
  has_google_ads: boolean
  has_ga4: boolean
  has_chatbot: boolean
  has_booking_system: boolean
  has_ecommerce: boolean
  has_spf: boolean
  has_dmarc: boolean
  seo_disaster: boolean
}
```

### ClayEnrichedLead (arricchimento completo)
```typescript
interface ClayEnrichedLead {
  // Dati anagrafici
  nome: string; telefono: string; email: string | null; sito: string | null
  citta: string; indirizzo: string | null; categoria: string | null

  // Registro Imprese
  partitaIva: string | null; codiceFiscale: string | null
  dataCostutuzione: string | null; formaGiuridica: string | null
  dipendenti: string | null; capitaleSociale: string | null
  fatturato: string | null; utile: string | null

  // LinkedIn
  linkedinCompany: string | null; linkedinCompanyDescription: string | null
  linkedinPerson: string | null; linkedinPersonName: string | null
  linkedinPersonTitle: string | null

  // Social
  instagram: string | null; instagramHandle: string | null
  facebook: string | null; tiktok: string | null; youtube: string | null

  // PEC
  pec: string | null

  // Tech
  techStack: string[]; technicalReport: TechnicalReport

  // Score
  opportunityScore: number; freshnessScore: number

  // Google
  googleReviews: GoogleReview[]; googleRating: number | null
  googleReviewsCount: number; isClaimed: boolean | null
  googleDescription: string | null

  // Competitor
  localCompetitors: LocalCompetitor[]; competitorAnalysis: CompetitorAnalysis | null

  // Ads
  adsAnalysis: AdsAnalysis | null

  // Trends
  trendsAnalysis: TrendsAnalysis | null

  // Social analysis
  socialAnalysis: SocialAnalysis | null

  // Registry
  registryAnalysis: RegistryAnalysis | null

  // Meta
  sources: string[]; enrichedAt: string
}
```

### PipelineItem
```typescript
interface PipelineItem {
  id: string
  lead_name: string
  lead_category: string | null
  lead_city: string | null
  lead_phone: string | null
  lead_email: string | null
  lead_website: string | null
  lead_score: number
  lead_data: ClayEnrichedLead | null
  stage: 'nuovo' | 'contattato' | 'trattativa' | 'vinto' | 'perso'
  deal_value: number
  notes: string
  created_at: string
  updated_at: string
}
```

### GoogleReview
```typescript
interface GoogleReview { text: string; stars: number }
```

### LocalCompetitor
```typescript
interface LocalCompetitor {
  name: string; rating: number | null; reviews_count: number | null
}
```

### CompetitorAnalysis
```typescript
interface CompetitorAnalysis {
  overallCompetitionScore: number
  competitors: LocalCompetitor[]
  marketPosition: {
    summary: string; strengths: string[]; weaknesses: string[]
    suggestedAngle: string; threatLevel: 'low' | 'medium' | 'high'
  }
  opportunities: string[]
  urgencyMessage: string
}
```

### AdsAnalysis
```typescript
interface AdsAnalysis {
  facebookAds: { isRunning: boolean; estimatedBudget: string | null; adTypes: string[]; since: string | null; totalAds: number; libraryUrl: string }
  googleAds: { isRunning: boolean; keywords: string[]; estimatedBudget: string | null }
  overallAdScore: number
  opportunities: string[]
  competitorContext: string
}
```

### TrendsAnalysis
```typescript
interface TrendsAnalysis {
  trend: 'growing' | 'stable' | 'declining'
  growthPercentage: number | null
  peakMonths: string[]
  bestContactTime: string
  marketOpportunity: string
  insights: string[]
  source: 'pytrends' | 'gpt' | 'error'
}
```

### SocialAnalysis
```typescript
interface SocialAnalysis {
  instagram: { handle: string | null; followers: number | null; lastPost: string | null; engagement: string | null; hasLink: boolean }
  facebook: { url: string | null; followers: number | null; lastPost: string | null; isActive: boolean }
  tiktok: { handle: string | null; followers: number | null; hasPresence: boolean }
  linkedin: { url: string | null; employees: number | null; hasPresence: boolean }
  overallScore: number
  missingPlatforms: string[]
  inactiveplatforms: string[]
  opportunities: string[]
}
```

### RegistryAnalysis
```typescript
interface RegistryAnalysis {
  foundedYear: number | null
  legalForm: string | null
  employees: string | null
  revenue: string | null
  insights: string[]
}
```

---

## 6. Worker Python — Dettaglio

### Main Loop (`worker_supabase.py`)
```python
while True:
    time.sleep(random.uniform(1.0, 5.0))  # desync workers
    
    # Priority 1: user jobs (recent)
    rows = supabase.table("searches").select("*") \
        .eq("status", "pending").order("created_at", desc=True).limit(1).execute()
    
    # Fallback: backlog jobs
    if not rows:
        rows = supabase.table("searches").select("*") \
            .eq("status", "pending").order("created_at", desc=True).limit(1).execute()
    
    if not rows: time.sleep(4); continue
    
    job = rows[0]
    
    # Atomic claim
    claim = supabase.table("searches").update({"status":"processing","results":None}) \
        .eq("id", job_id).eq("status","pending").execute()
    if not claim.data: continue  # già preso
    
    # Esegui scraping
    core_results = asyncio.run(_run_core_scraper(category, location, zone, ...))
    formatted = _format_results(core_results)
    
    # Scrivi risultato
    supabase.table("searches").update({"status":"completed","results":formatted}) \
        .eq("id", job_id).execute()
    
    time.sleep(cooldown_s)
```

### Cosa fa `_run_core_scraper`:
1. Chiama `scrape_google_maps_playwright(category, location)` → Playwright
2. Per ogni lead con sito: `audit_website_with_status(website)` → audit tecnico
3. `run_technical_audit(website)` → analisi HTML, SEO, email security
4. `deep_scrape_mobile_from_website(website)` → cerca cellulare nel sito
5. `_scrape_reviews_and_competitors()` → recensioni + competitor via Playwright
6. Calcola `opportunity_score` (0-100) e `freshness_score` (0-100)
7. Detecta cambiamenti vs audit precedente (`_detect_changes`)

### Campi tracciati per changes:
- Meta Pixel (installato/rimosso)
- Google Tag Manager
- Instagram, Facebook
- Sito Web (creato/offline)
- Email
- Rating Google (variazioni ≥ 0.3)

### Opportunity Score (0-100):
- +25: no Meta Pixel
- +30: no sito web
- +10: no Instagram
- +15: disastro SEO
- +10: no DMARC
- +5: no mobile / sito lento (>4s)
- +20: rating < 3.5
- +10: rating < 4.0
- +5: < 10 recensioni

---

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
- Richiede `GOOGLE_PLACES_API_KEY` + `OPENAI_API_KEY`

### `ads-analysis.ts` — Analisi advertising
- `analyzeAdsPresence()`: Facebook Ads Library API (gratuita) + GPT per Google Ads
- Produce: stato ads, budget stimato, opportunità commerciali
- Richiede `FB_ADS_TOKEN` (opzionale) + `OPENAI_API_KEY`

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
OPENAI_API_KEY=sk-...

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
