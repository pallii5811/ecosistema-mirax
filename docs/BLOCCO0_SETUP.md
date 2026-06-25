# Blocco 0 — Setup staging (passo passo)

## 1. Supabase DEV (obbligatorio prima del worker)

1. Vai su [supabase.com/dashboard](https://supabase.com/dashboard) → **New project** (es. `mirax-ecosistema-dev`).
2. Regione EU (Frankfurt) consigliata.
3. **Schema base:** il progetto nuovo è vuoto. Per avere le stesse tabelle di produzione:
   - **Opzione A (consigliata):** Supabase Dashboard → progetto **produzione** → Database → Backups → export schema (o usa `pg_dump` solo schema).
   - **Opzione B:** SQL Editor → incolla lo schema da documentazione interna se disponibile.
4. Poi esegui le migration incrementali in ordine (SQL Editor, una alla volta):
   - `db/migrations/2026_04_24_lists_environment_link.sql`
   - `db/migrations/2026_05_24_company_lookup_cache.sql`
   - `db/migrations/2026_05_24_user_openapi_unlocks.sql`
   - `db/migrations/2026_06_22_outreach_log.sql`
   - `db/migrations/2026_06_23_searches_zone.sql`
5. Authentication → crea un utente test (email/password).
6. Copia da **Project Settings → API**:
   - Project URL
   - `anon` key
   - `service_role` key (segreta)

## 2. `.env.local` locale (cartella Dev)

```powershell
cd "c:\Users\Simone\CascadeProjects\WEB APP CKB - Dev"
copy .env.staging.example .env.local
# Modifica .env.local con le chiavi DEV
node scripts/check-staging-env.mjs
npm run dev
```

## 3. Server 116 — API staging `:8002`

Servizi systemd in `backend_mirror/systemd/`:

- `mirax-audit-api-staging.service` → porta **8002**
- `mirax-worker-staging.service` → **solo** con `.env` Supabase dev

Deploy (da PowerShell, chiave SSH default):

```powershell
cd "c:\Users\Simone\CascadeProjects\WEB APP CKB - Dev"
ssh root@116.203.137.39 "mkdir -p /home/worker/app/backend-staging"
scp backend_mirror/worker_supabase.py backend_mirror/audit_engine.py root@116.203.137.39:/home/worker/app/backend-staging/
scp backend_mirror/systemd/mirax-audit-api-staging.service root@116.203.137.39:/etc/systemd/system/
```

Sul server 116, crea `/home/worker/app/backend-staging/.env`:

```env
SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_dev_service_role_key
DEMO_MAX_RESULTS=50
```

Poi:

```bash
systemctl daemon-reload
systemctl enable --now mirax-audit-api-staging
curl -s http://127.0.0.1:8002/health
```

**Non avviare** `mirax-worker-staging` finché `.env` non ha Supabase **dev** (mai produzione).

```bash
# Solo dopo Supabase dev configurato:
scp backend_mirror/systemd/mirax-worker-staging.service root@116.203.137.39:/etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mirax-worker-staging
```

## 4. Vercel preview

1. [vercel.com](https://vercel.com) → **Add New Project** → import `pallii5811/ecosistema-mirax`.
2. Environment variables (stesse di `.env.local` dev, **non** prod).
3. `BACKEND_URL` = `http://116.203.137.39:8002`
4. Deploy branch `main`.

## 5. Verifica end-to-end

| Check | Comando / azione |
|-------|------------------|
| API staging | `curl http://116.203.137.39:8002/health` |
| Env locale | `node scripts/check-staging-env.mjs` |
| App | Login su `localhost:3000` con utente dev |
| Ricerca | Nuova ricerca → job su Supabase **dev** only |

## Regole

- **116:8001** e worker prod su 116 = ancora produzione legacy — non toccare.
- **178** = produzione attiva — niente deploy da Dev senza test su 116:8002.
- Worker staging **1 istanza** basta per dev.
