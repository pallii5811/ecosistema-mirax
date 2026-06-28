# Score AI — come funziona oggi (rule-based)

**Importante:** MIRAX non usa oggi un modello ML addestrato per lo score lead.  
Tutto è **rule-based** (regole pesate) — coerente tra worker Python e frontend TypeScript.

## Opportunity score (0–100)

| Segnale | Punti | Dove |
|---------|------:|------|
| No Meta Pixel | +25 | `worker_supabase._calc_opportunity_score`, `ResultsTable.calcOpportunityScore` |
| No sito web | +30 | idem |
| No Instagram | +10–15 | idem |
| Problemi SEO / disastro SEO | +15–20 | idem |
| No DMARC | +10 | idem |
| Sito lento (>4s) | +5 | worker |
| Rating Google basso | +10–20 | worker |
| Poche recensioni | +5 | worker |

**Più alto = più opportunità commerciale** (più gap da colmare).

## Digital maturity (`leadIntelligence.ts`)

Score separato 0–100 basato su presenza pixel, GTM, Ads, Analytics, SSL, social.  
Usato per tag opportunità e copy pitch — non è lo stesso numero del opportunity score.

## Freshness score (`lead-object.ts` / worker)

- 100 subito dopo audit
- Decade linearmente a 0 in **30 giorni**
- Base per re-audit automatico (Blocco 3)

## Roadmap ML (non implementato)

Un futuro score ML richiederebbe: dataset etichettato (conversioni pipeline), feature store, training offline, A/B vs rule-based.

## Score adattivo per utente (Blocco 4)

`user_scoring_models` si ricalibra da:
- `outreach_log` (interested / not_interested)
- `lead_pipeline` (vinto / perso)
- `lead_interactions` (contacted / converted / rejected)

Regola: se i deal positivi hanno score medio > negativi (+8), i pesi salgono del ~4% (max 45 per fattore).
