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
- Fase 6 Generic Web: runtime `generic_web_research_v1` sempre `generic_fallback_partial`.
- 12 replay primari: lineage, query origin, parent, round, signal ID, date, evidence e dominio canonici.
- Directory, fonti secondarie, segnali impliciti, stale, geografia ed enterprise sono respinti prima della promozione.
- Exhaustion globale non viene mai dichiarata da SERP campionate; hard cap verificato prima di ogni query.
- Fase 7 Orchestrator: boundary compiler-plan, registry runtime, breadth-first, cursor e budget cumulativo.
- Stop verificato su `qualified_count`; raw, unique, resolved, audited, evidence verified, rejected e published separati.
- `all` fonde evidenze multi-adapter sulla stessa entità; `any` conserva alternative e lineage.
- Overspend adapter causa hard failure; fallback parziale non dichiara market/source exhaustion globale.
- Il nuovo orchestratore resta offline e non è stato attivato nei worker persistenti.
- Fase 8 Opportunity Value Score: dieci componenti pesate, penalità, missing field e top-tier trasparenti.
- Dominio, operating entity, evidence, buyer fit e freshness mancanti sono critical e limitano lo score a `0,49`.
- Il qualifier conserva i gate fail-closed e rifiuta esplicitamente score `< 0,55`; nessun campo forte compensa un critical missing.
- Fonte, freshness, segnale, urgenza, causality, valore commerciale, contattabilità e confidence sono spiegabili per lead.
- Test scoring e ranking deterministico inclusi nella suite Source Adapter: verdi.
- TypeScript/Python compile e diff check verdi; nessuna chiamata provider, costo reale `EUR 0`.
- Fase 9 offline: query nuove su Digital Audit, Procurement, Hiring, Marketing, Expansion, multi-segnale e fallback.
- Archetipi strutturati: canary replay `5/5` e batch replay `20/20` qualified, score `>=0,55`, zero publication e costo `EUR 0`.
- Corretto mismatch Digital Audit: buyer fit ora deriva dalla discovery categoria+territorio ed è tracciato; mismatch categoria resta respinto.
- Corretto mismatch Growth `all`: ogni segnale deve essere provato nel testo e propagato in un EvidenceRecord canonico separato.
- Fallback: `5/5`; su richiesta `20` con sole `12` evidenze restituisce `12/20` parziale, senza inventare exhaustion o lead.
- Suite Source Adapter `75 passed`; regressioni lifecycle/commerciali `47 passed`; TypeScript/Python compile verdi.
- Validazione live/human precision non eseguita e non certificata; worker e pubblicazione restano disattivati.
- Fase 10 offline: stress `100/100`, `500/500`, `5.000/5.000` qualified con cinque shard e dedup globale.
- Progress snapshot monotoni; resume cursor per adapter verificato senza replay delle pagine già acquisite.
- Budget `EUR 0,009`: esattamente una call simulata da `EUR 0,005`; seconda call bloccata prima dell'esecuzione.
- Esaurimento autorevole: `600/1.000` e `partial_sources_exhausted`, senza riempimento artificiale.
- Suite Source Adapter/scale `82 passed`; lease, idempotenza, cost governor e lifecycle `61 passed`.
- Costo provider reale `EUR 0`; nessun deploy, canary, worker persistente, publication o charge cliente.
- Boundary piano v1 reale corretto: segnali, freshness, geografie, settori, target, source policy e hard budget non si perdono.
- `official_domain_verified` e confidence sono ora campi canonici; dominio presente ma non verificato viene respinto.
- Procurement usa resolver identità iniettabile: ANAC senza dominio risolve entro reservation o fallisce chiuso.
- Hard cap Procurement applicato prima di provider e resolver; budget `EUR 0,005` permette una sola resolution da `EUR 0,005`.
- Suite Source Adapter `85 passed`; domain resolver, cost, lease, lifecycle e contratto piano `68 passed`.
- Test Hiring, forensic legacy, lifecycle, contratti e compile Python/TypeScript: verdi; costo provider reale `EUR 0`.
- Test Fase 3, regressioni strutturate, contratti e compile Python/TypeScript: verdi; costo provider `EUR 0`.
- Provenance dominio standardizzata per tutti gli adapter e verificata sia nel qualifier sia nel lifecycle.
- Il lifecycle accetta solo proof contract di adapter esplicitamente trusted; adapter sconosciuti, mismatch ID e prove incomplete restano respinti.
- Bridge worker Source Adapter implementato solo in shadow, default-off e fail-closed: `results=[]`, `published=0`, nessun fallback legacy, sync grafo o charge cliente.
- Hard cap shadow assoluto `EUR 0,125`; autorizzazione, piano canonico e flag runtime sono tutti obbligatori.
- Suite Source Adapter `88 passed`; lifecycle/costi/lease/contratti `62 passed`; TypeScript/Python compile e diff check verdi.
- Nessun deploy, canary o provider call eseguito; costo provider reale della fase `EUR 0`.

## Prossimo passo sicuro
- Commit/push del bridge shadow; poi preflight staging con flag disattivati. Nessun canary finché non viene autorizzato esplicitamente.
