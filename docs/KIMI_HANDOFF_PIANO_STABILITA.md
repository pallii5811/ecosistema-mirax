# Handoff Kimi → Cursor — Piano Stabilità & Fiducia UX

**Repo:** `WEB APP CKB - Dev` (`ecosistema-mirax`)  
**Data:** 2026-06-29  
**Regola madre:** SOLO VALORE ENORME — niente decorativo, niente complessità non standardizzabile.

---

## North Star (cosa paga l’utente)

Loop unico: **Trova → Capisci perché → Fidati → Agisci** (salva, pitch, CRM).

Ogni task deve rispondere: *“Quale minuto risparmio o quale euro faccio guadagnare all’utente?”*

---

## Scope Fase 1 — SOLO questo (in ordine)

### P0 — Refund crediti (fiducia)

**Problema:** job `error` / stuck / 0 risultati ingiusti → utente perde fiducia (e a volte crediti incrementalmente durante poll).

**Obiettivo:** politica crediti inequivocabile.

| Caso | Comportamento atteso |
|------|----------------------|
| Job `error` prima di mostrare lead | 0 addebiti |
| Job stuck > N min (es. 15) senza nuovi lead | messaggio chiaro + nessun addebito extra |
| Lead già mostrati e addebitati, poi job crash | lead restano, niente refund (documentato) |
| Utente ferma ricerca | addebito solo lead già in lista |

**File da analizzare/modificare:**
- `src/components/DashboardShell.tsx` — `deductCredits`, polling autoscrape
- `src/app/api/use-credits/route.ts`
- `src/app/api/check-scrape-job/route.ts`
- Eventuale `src/app/api/refund-credits/route.ts` (se serve)

**Deliverable Kimi:**
- Proposta implementazione (max 1 pagina)
- Diff o pseudocodice per i punti di aggancio
- Test manuali / script smoke

---

### P0 — Realtime status ricerca (niente polling sprecato)

**Problema:** poll ogni N sec su `/api/check-scrape-job` — lento, costoso, UX peggiore.

**Obiettivo:** Supabase Realtime su riga `searches` (campo `status`, `results` opzionale).

**File da analizzare:**
- `src/lib/realtime/signal-stream.ts` (pattern esistente)
- `src/components/DashboardShell.tsx` — sostituire/affiancare poll
- Migration se serve publication su `searches` (verificare se già in Realtime)

**Deliverable Kimi:**
- Design: subscribe `searches.id=eq.{jobId}`, fallback poll se Realtime off
- Stima diff (righe/file)
- Non rompere sessionStorage restore

---

### P1 — Enrich async (no timeout Vercel)

**Problema:** `POST /api/enrich-lead` sincrono → 30–90s, timeout Hobby/Pro.

**Obiettivo:** stesso pattern delle ricerche: job `enrichment_jobs` o riuso `searches`-like + worker o route background.

**File da analizzare:**
- `src/app/api/enrich-lead/route.ts`
- `src/lib/clay-enrichment.ts`
- `backend_mirror/worker_supabase.py` (se enrich va su worker)

**Deliverable Kimi:**
- Opzione minima (MVP): queue table + poll/realtime
- Opzione lazy: solo cache hit sync, miss → job async
- Cosa NON fare: riscrivere tutto clay

---

## Cosa NON fare in Fase 1

- ❌ Nuove tab UI / grafo decorativo
- ❌ Multi-agent / PKI / pgvector / connector CRM stub
- ❌ Migrazione completa `searches.results` → tabella leads (P2, solo design doc ok)
- ❌ Feature flag ecosistema nuovi
- ❌ Refactor totale `actions.ts`

---

## Definition of Done (ogni task)

1. Codice in `WEB APP CKB - Dev` branch `main` o branch dedicato
2. `npm run build` passa
3. `npm run test:universe` passa (se il task tocca componenti Universe)
4. Scenario E2E descritto in 5 bullet (cosa clicca l’utente, cosa vede)
5. **Staging E2E validato** su Supabase dev + worker staging (non solo codice scritto)
6. Nessuna regressione crediti su happy path
7. Copy UX in italiano, chiaro, onesto (no spinner infinito)
8. Security: nessun secret hardcoded; service role usato solo per write/cron; read user-facing usano client autenticati con RLS

---

## Ambiente

| | Valore |
|--|--------|
| Supabase dev | `ktspchugdwpqvxhmysap` |
| Worker staging | `116.203.137.39:8002` |
| Vercel | `ecosistema-mirax.vercel.app` |
| **NON toccare** | `WEB APP CKB - Copia` / produzione 178:8001 |

---

## Cosa passare a Cursor dopo Kimi

1. Branch/commit o diff summary
2. Cosa ha fatto vs cosa ha solo analizzato
3. Blocker / decisioni aperte (es. schema tabella refund)
4. Output test
5. File toccati (lista)

Cursor continuerà **seguendo gli stessi criteri** (valore enorme, qualità massima, UX totale).

---

## Documenti di riferimento

- `docs/MIRAX_ECOSISTEMA_COMPLETO_AZ.md` — architettura A→Z
- `docs/ARCHITETTURA_MIRAX_TECNICA_AZ.md` §16 crediti, §43 criticità
- `ECOSISTEMA_ROADMAP.md` — aggiornare stati dopo Fase 1
