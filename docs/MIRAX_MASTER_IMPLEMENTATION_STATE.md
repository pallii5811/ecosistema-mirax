# MIRAX Master Implementation State

Ultimo aggiornamento verificato: 2026-07-15 Europe/Rome.

## Checkpoint corrente
- Repository `pallii5811/ecosistema-mirax`; branch `safety/mirax-v5-11-codex-checkpoint`.
- Ultimo canary hiring quarantinato: `0 qualified`; nessuna pubblicazione o addebito cliente.

## Stato dei gate
- Forensic: `2 SHOULD_REJECT`, `2 INSUFFICIENT_DATA`, `0 SHOULD_QUALIFY`.
- Root cause: pagine careers generiche erano considerate erroneamente evidenza di vacancy.
- Correzione: pre-filtro hiring deterministico zero-cost prima dell'estrazione a pagamento.
- Lifecycle invariato e fail-closed; FMACH non viene promosso senza prova del target fit.
- Fixture dei quattro candidati e test positivi/negativi mirati: verdi.
- Nessun nuovo canary, deploy o provider call autorizzato.
- Fase 1 Source Adapter: contratti canonici Python/TypeScript e Capability Registry fail-closed implementati.
- Lane senza adapter reale: `unsupported` o `generic_fallback_partial`; mai `supported` per etichetta teorica.
- Normalizzatore candidato unico al boundary; dominio verificato nested promosso nel campo canonico.
- Replay offline procurement, marketing investment e hiring operational: routing semantico corretto, fallback esplicito.
- Test Fase 1, contratti esistenti e TypeScript compile: verdi; costo provider `EUR 0`.
- Fase 2 Digital Audit: percorso Maps+audit legacy incapsulato in `legacy_digital_audit_v1` senza riscrittura.
- 20 replay Digital Audit: dominio, evidenze tecniche, contatti, dedup e requested_count verdi.
- Timeout/fetch fallito non qualifica più l'assenza di tecnologia; exhaustion legacy dichiarata best-effort.
- Fase 3 Procurement: adapter discovery-first `public_procurement_v1` su boundary ANAC/TED.
- 20 replay positivi e 6 avversariali verificano winner, authority/publisher, stato, settore, geografia e freshness.
- Provenienza, evidenza, importo, CPV, data, dedup, cursor ed exhaustion sono canonici e fail-closed.
- Fase 4 Hiring: adapter `structured_hiring_v1` per JSON-LD, vacancy individuali, ATS e careers ufficiali.
- 20 replay PMI positivi; pagine generiche, scadute, enterprise, ruoli errati, publisher e recruiter proxy restano respinti.
- Dominio, azienda diretta, ruolo, luogo, data, stato attivo, freshness, PMI, dedup e provenance sono fail-closed.
- Hard cap pre-query verificato: budget `EUR 0,009` consente una sola reservation/query da `EUR 0,005`.
- Fase 5 Growth: adapter `official_growth_signals_v1` su siti ufficiali e fonti editoriali strutturate.
- Replay offline: 20/20 Marketing Investment e 20/20 Expansion con prova diretta/proxy forte e freshness.
- Proxy deboli, stale, publisher, fonti secondarie non corroborate, rumore agenzie, geografia ed enterprise sono respinti.
- Semantica `any` verificata; `all` fallisce chiuso se un record non prova ogni segnale richiesto.
- Registry runtime: Digital Audit, Procurement, Hiring e Growth; Ad Library resta esplicitamente non coperta.
- Test Hiring, forensic legacy, lifecycle, contratti e compile Python/TypeScript: verdi; costo provider reale `EUR 0`.
- Test Fase 3, regressioni strutturate, contratti e compile Python/TypeScript: verdi; costo provider `EUR 0`.

## Prossimo passo sicuro
- Rafforzare il Generic Web Research Fallback come copertura parziale dichiarata; nessun canary/provider live.
