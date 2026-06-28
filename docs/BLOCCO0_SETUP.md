# Blocco 0 — Setup staging (passo passo)

Progetto Supabase DEV: **ecosistema mirax** (`ktspchugdwpqvxhmysap`, EU West).

## 1. Chiavi Supabase (5 minuti)

1. [Dashboard API](https://supabase.com/dashboard/project/ktspchugdwpqvxhmysap/settings/api) → copia **anon** e **service_role**.
2. [Database password](https://supabase.com/dashboard/project/ktspchugdwpqvxhmysap/settings/database) → password postgres (quella scelta alla creazione).

```powershell
cd "c:\Users\Simone\CascadeProjects\WEB APP CKB - Dev"
copy .env.ecosistema.secrets.example .env.ecosistema.secrets
# Compila le 3 righe in .env.ecosistema.secrets
npm run setup:ecosistema
```

Lo script:
- aggiorna `.env.local` (mai più produzione)
- applica `db/bootstrap/generated_schema.sql` + RLS + migration via Docker/psql
- esegue `check-staging-env`

**Alternativa manuale DB:** SQL Editor → incolla in ordine:
`db/bootstrap/generated_schema.sql` → `db/bootstrap/rls_dev.sql` → `db/migrations/*.sql`

## 2. Utente test

Supabase → Authentication → Users → Add user (email/password).

## 3. App locale

```powershell
npm run dev
# http://localhost:3000 — login con utente test
```

## 4. Server 116 — worker staging

API staging `:8002` già attiva. Worker **solo** dopo Supabase dev:

Sul server, `/home/worker/app/backend-staging/.env`:

```env
SUPABASE_URL=https://ktspchugdwpqvxhmysap.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role dev>
DEMO_MAX_RESULTS=50
```

```bash
systemctl enable --now mirax-worker-staging
journalctl -u mirax-worker-staging -f
```

## 5. Vercel preview

Import `pallii5811/ecosistema-mirax` → env come `.env.local` dev → `BACKEND_URL=http://116.203.137.39:8002`.

## Verifica

| Check | Comando |
|-------|---------|
| Env | `npm run check:staging-env` |
| API staging | `curl http://116.203.137.39:8002/docs` |
| Ricerca | Nuova ricerca → tabella `searches` su progetto **dev** |

## Regole

- **116:8001** e **178** = produzione — non toccare da Dev.
- Worker staging: **1 istanza** su 116, Supabase **solo dev**.
