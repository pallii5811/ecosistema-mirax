# MIRAX CKB — Architettura Completa (Parte 1/3)

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
