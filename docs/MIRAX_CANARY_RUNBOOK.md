# MIRAX canary runbook

Questo runbook esiste per evitare la ripetizione dell'incidente in cui AI/worker hanno consumato credito prima di avere un quality gate sufficiente.

## Stato safe predefinito

Finche' la canary non e' approvata esplicitamente:

- Vercel/Next deve avere `MIRAX_SEARCH_DISABLED=1`.
- Server worker deve avere `MIRAX_WORKER_DISABLED=1`.
- Paid extraction deve avere `ANTHROPIC_EXTRACT_ENABLED=0`.
- I worker systemd devono essere `disabled` e `inactive`.
- Il cap LLM deve restare basso: `MIRAX_LLM_MAX_COST_USD_PER_JOB=0.03`.

## Preflight obbligatorio

Prima di riattivare qualsiasi worker:

```bash
npm run preflight:canary
```

Il comando deve passare tutti questi gate:

- TypeScript compile.
- UI mode guards: query signal-led non deve mostrare Maps.
- Signal visibility guards: a fine ricerca restano solo lead con evidenza.
- Routing guards: query "aziende che investono in marketing" va su `organic_web_search`.
- 50 real-user query parser suite.
- Backend quality/cost guards.
- App URL health su `https://ecosistema-mirax-two.vercel.app`.
- Server 116: worker spenti, Anthropic off, cap costo presente.

Se fallisce anche un solo gate, non riattivare.

## Canary pagante minima

Richiede OK umano esplicito prima di procedere.

Configurazione massima consentita per la prima canary:

- 1 solo worker staging.
- 1 sola query.
- Target massimo: 5 lead.
- `ANTHROPIC_EXTRACT_ENABLED=0` nella prima prova; se serve LLM, abilitarlo solo dopo una canary zero-LLM verde.
- `MIRAX_LLM_MAX_REQUESTS_PER_JOB=3`.
- `MIRAX_LLM_MAX_COST_USD_PER_JOB=0.03`.
- Timeout pagina: `AGENTIC_PAGE_TIMEOUT_MS=8000`.
- Timeout navigazione: `AGENTIC_NAV_TIMEOUT_MS=12000`.

Query canary consigliata:

```text
trovami 5 PMI a Milano e Torino che stanno investendo in marketing con evidenza verificabile di campagne o budget ads
```

## Stop condition immediata

Fermare subito worker/search se accade uno di questi eventi:

- compare una big brand o azienda famosa non PMI;
- compare un lead senza evidenza verificabile del segnale richiesto;
- la UI addebita crediti per pending/non confermati;
- costo job stimato o reale supera 0,03 USD;
- il primo lead valido non arriva entro il budget temporale definito per la canary;
- il job termina con risultati generici tipo Maps quando la query e' signal-led.

## Criteri minimi per passare la canary

La canary passa solo se:

- 5/5 lead sono PMI/professionisti in target;
- 5/5 lead hanno evidenza verificabile del segnale richiesto;
- 0 big brand;
- 0 lead generici;
- contatti/sito sono presenti o il motivo della mancanza e' esplicito;
- costo entro cap;
- la UI mostra stato, risultati e crediti in modo coerente.

## Produzione

La produzione non si riattiva in massa dopo una singola canary.

Sequenza corretta:

1. Canary zero-LLM.
2. Canary con cap LLM minimo, se necessario.
3. 3 query diverse da 5 lead.
4. 1 query da 25 lead.
5. Solo dopo metriche verdi, rimuovere `MIRAX_SEARCH_DISABLED=1` e abilitare worker gradualmente.

