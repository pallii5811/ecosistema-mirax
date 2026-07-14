MIRAX — DIRETTIVA MASTER DEFINITIVA E PERMANENTE
SINGLE SOURCE OF TRUTH
SOSTITUISCE TUTTE LE PRECEDENTI DIRETTIVE QUANDO SONO IN CONFLITTO

Agisci come Principal Engineer, AI Systems Architect, Data Engineer,
Security Engineer e responsabile tecnico operativo di MIRAX.

Non limitarti a proporre soluzioni, produrre documentazione o descrivere
problemi. Lavora direttamente sul repository, verifica ogni risultato e
continua autonomamente fino al raggiungimento dei gate definiti qui sotto.

Questa direttiva deve essere salvata integralmente in:

docs/MIRAX_CODEX_MASTER_DIRECTIVE.md

Deve essere riletta:

- all’inizio di ogni sessione;
- dopo ogni compattazione del contesto;
- prima di ogni canary;
- prima di dichiarare qualsiasi milestone completata.

Aggiorna inoltre in modo sintetico:

docs/MIRAX_MASTER_IMPLEMENTATION_STATE.md

Il Master State deve contenere solamente:

- checkpoint corrente;
- release corrente;
- gate superati;
- gate falliti;
- metriche reali;
- root cause aperte;
- prossima attività esatta.

Non creare altri documenti strategici concorrenti.

======================================================================
0. CHECKPOINT DI PARTENZA
======================================================================

Repository:

pallii5811/ecosistema-mirax

Branch:

safety/mirax-v5-11-codex-checkpoint

HEAD locale e remoto atteso:

70f45bfb47f580588f023cde87768da42ca42e18

Prima di qualsiasi operazione verifica:

- git status pulito;
- HEAD locale uguale allo SHA remoto;
- nessun processo git orfano;
- zero job attivi;
- zero canary attivi;
- zero reservation aperte o stale;
- zero pubblicazioni cliente da test;
- zero addebiti cliente da test;
- tutti i worker persistenti inactive e disabled;
- MIRAX_SEARCH_DISABLED=1;
- ANTHROPIC_EXTRACT_ENABLED=0 sui servizi persistenti;
- staging healthy;
- produzione non modificata.

Se uno di questi punti non è vero, ripristina lo stato sicuro prima di
procedere.

======================================================================
1. MISSIONE DI PRODOTTO
======================================================================

MIRAX deve trasformare una richiesta commerciale in linguaggio naturale in
lead aziendali reali, altamente pertinenti, verificati, recenti, deduplicati
e immediatamente utilizzabili per vendere.

Percorso fondamentale:

QUERY UTENTE
→ COMPRENSIONE DEL SELLER
→ COMPRENSIONE DELL’OFFERTA
→ IDENTIFICAZIONE DEL BUYER
→ PROBLEMI RISOLTI
→ EVENTI E SEGNALI D’ACQUISTO
→ PIANO DI RICERCA
→ FONTI REALI
→ AZIENDE REALI
→ IDENTITÀ AZIENDALE
→ DOMINIO UFFICIALE
→ EVIDENZA PRIMARIA
→ FRESHNESS
→ WHY-NOW
→ CONTATTI PUBBLICI
→ TARGET FIT
→ DEDUPLICAZIONE
→ RANKING
→ QUALIFICATION
→ PUBBLICAZIONE ATOMICA

La priorità permanente è:

1. lead reali;
2. valore commerciale;
3. pertinenza rispetto alla query;
4. evidenza verificabile;
5. dominio ufficiale;
6. volume;
7. copertura delle fonti;
8. contatti;
9. costo;
10. stabilità e sicurezza;
11. UX.

Non lavorare su nuove funzionalità, refactoring generale, documentazione
estesa, gold tooling, soak aggiuntivi o miglioramenti estetici mentre il
percorso query → qualified lead non è dimostrato.

======================================================================
2. CONTRATTO DI UN LEAD DI VALORE
======================================================================

Un lead può essere considerato QUALIFIED soltanto quando include:

- azienda reale e operativa;
- nome aziendale canonico;
- entità correttamente classificata;
- dominio ufficiale verificato;
- target buyer coerente con la query;
- segnale commerciale specifico;
- collegamento causale tra segnale e offerta del seller;
- fonte reale;
- URL della fonte;
- publisher;
- data o indicatore di freshness verificabile;
- estratto di evidenza;
- spiegazione why-now;
- confidence;
- eventuali contraddizioni;
- dimensione o target fit quando richiesto;
- contatto pubblico pertinente quando disponibile;
- costo attribuito;
- provenienza completa:
  query → lane → source → URL → entity → evidence → decisione.

Non qualificare mai:

- directory;
- portali;
- motori di ricerca;
- publisher scambiati per buyer;
- pagine categoria;
- enti pubblici quando non richiesti;
- multinazionali o grandi enterprise quando la query richiede PMI;
- aziende non operative;
- domini non ufficiali;
- aziende duplicate;
- segnali generici;
- segnali non recenti;
- segnali non collegati all’offerta;
- risultati inseriti per raggiungere artificialmente il numero richiesto.

Un candidato raw non è un lead.
Un’entità risolta non è un lead.
Un dominio trovato non è un lead.
Un risultato dell’extractor non è un lead.
Soltanto una riga che supera l’intero lifecycle è QUALIFIED.

======================================================================
3. CONTRATTO DELLE QUERY
======================================================================

Il sistema deve comprendere dinamicamente:

- cosa vende l’utente;
- a chi può venderlo;
- quali problemi risolve;
- quali aziende hanno maggiore probabilità di acquistare;
- quali eventi indicano necessità;
- quali fonti possono dimostrarli;
- quali vincoli geografici, dimensionali, temporali e settoriali esistono;
- quanti risultati sono richiesti.

Il motore non deve essere codificato esclusivamente per workplace safety,
hiring o altri esempi specifici.

Gli archetipi validati devono diventare componenti riutilizzabili che il
planner può combinare:

- hiring e crescita del personale;
- criticità digitali e tecnologiche;
- appalti e contratti vinti;
- espansioni, nuove sedi e nuovi impianti;
- investimenti e acquisti;
- cambiamenti organizzativi;
- compliance e obblighi normativi;
- finanziamenti;
- nuovi prodotti o nuovi mercati;
- cambi di management;
- eventi settoriali specifici;
- segnali definiti dinamicamente dalla query.

L’AI interpreta semanticamente la query.

Il codice deterministico:

- normalizza;
- valida;
- assegna source lane;
- applica vincoli;
- traccia provenienza;
- impedisce pubblicazioni invalide;
- controlla costi;
- deduplica.

Non affidare all’LLM ciò che può essere verificato deterministicamente.

======================================================================
4. MAI RISPOSTA VUOTA O INUTILE
======================================================================

MIRAX non deve mai mostrare semplicemente:

“0 risultati”

senza spiegazione e senza continuazione operativa.

Non deve però inventare aziende o segnali.

Ogni ricerca deve terminare con uno stato esplicito:

- completed_requested_count;
- partial_market_exhausted;
- partial_sources_exhausted;
- partial_budget_exhausted;
- partial_time_limit;
- clarification_required;
- failed_recoverable;
- failed_terminal.

Se exact_qualified_count è zero, restituire comunque:

- numero richiesto;
- numero scoperto;
- numero di entità uniche;
- numero risolto;
- numero auditato;
- numero qualificato;
- fonti esplorate;
- shard esplorati;
- pagine elaborate;
- motivi di scarto aggregati;
- filtri che hanno ridotto il mercato;
- fonti ancora disponibili;
- stima del mercato residuo;
- possibili espansioni della query;
- risultati vicini ma non esatti, separati e chiaramente etichettati;
- possibilità di continuare la ricerca.

I risultati ampliati non devono mai essere presentati come exact match.

Se aziende valide esistono nelle fonti accessibili, il sistema deve continuare
a cercare fino al requested_count o fino a un esaurimento realmente
dimostrato.

======================================================================
5. CONTRATTO DI VOLUME
======================================================================

requested_count indica il numero di QUALIFIED richiesti.

Non fermare la discovery quando:

raw_candidate_count == requested_count

Fermarla soltanto quando:

qualified_count == requested_count

oppure quando uno dei limiti autorizzati è realmente raggiunto e documentato.

Distinguere sempre:

- discovered_count;
- raw_candidate_count;
- unique_entity_count;
- resolved_count;
- audited_count;
- evidence_verified_count;
- qualified_count;
- published_count;
- rejected_count.

Per requested_count=5 è consentito un pool iniziale raw fino a 15 e un massimo
prudenziale di 25 nel canary corrente.

Questo non deve diventare un limite definitivo del prodotto.

In produzione la logica deve essere adattiva:

- stimare il rejection rate;
- aumentare il pool raw;
- continuare su nuove pagine;
- continuare su nuovi shard;
- continuare sulle source lane produttive;
- fermarsi sul numero di qualified;
- non degradare la qualità per riempire il batch.

Per raggiungere 500 o 5.000 risultati verificare:

- decomposizione della query;
- shard geografici;
- shard settoriali;
- shard per segnale;
- shard per source class;
- paginazione completa;
- cursor persistenti;
- breadth-first discovery;
- espansione adattiva;
- source diversification;
- checkpoint;
- lease;
- retry idempotenti;
- resume;
- deduplicazione globale;
- risultati progressivi;
- source exhaustion dimostrabile;
- market exhaustion dimostrabile.

======================================================================
6. CONTRATTO CANONICO INTERNO
======================================================================

Eliminare incompatibilità tra planner, extractor, resolver, worker e
publication gate.

Deve esistere una rappresentazione canonica unica per:

- signal_id;
- signal aliases;
- signal_match_mode;
- source_lane;
- source_class;
- entity_class;
- domain_status;
- lifecycle_stage;
- rejection_code;
- evidence_status;
- target_fit_status.

Normalizzare gli alias una sola volta al confine di ingresso.

Non permettere che:

hiring_operational

diventi:

hiring

senza che tutti i componenti condividano la stessa rappresentazione canonica.

signal_match_mode deve essere rispettato:

- any: è sufficiente almeno uno dei segnali richiesti;
- all: sono necessari tutti i segnali richiesti.

Le query diversificate nei round successivi devono preservare:

- source_lane;
- expected_signals;
- source_class;
- query origin;
- parent query;
- discovery round;
- provenance.

Nessuna query può degradare silenziosamente a supplemental perdendo la
lineage.

======================================================================
7. STOP AL LOOP DI LIVE DEBUG
======================================================================

Non correggere più un bug alla volta spendendo ogni volta su:

modifica
→ deploy
→ canary
→ nuovo bug
→ altra modifica.

Prima di nuovi canary pagati costruisci replay deterministici usando le
tracce complete dei canary già effettuati.

Il replay end-to-end deve includere:

- piano;
- query;
- lane;
- risultati SERP;
- URL;
- contenuto della pagina;
- extraction;
- entity resolution;
- domain resolution;
- evidence verification;
- target classification;
- lifecycle;
- rejection;
- costo simulato.

Una singola suite deve rilevare congiuntamente:

- perdita dei metadati lane;
- alias incompatibili;
- semantica any/all errata;
- raw count usato al posto del qualified count;
- portali scambiati per aziende;
- enti pubblici;
- enterprise fuori target;
- sottodomini careers ufficiali;
- dominio ufficiale non promosso;
- duplicazioni;
- doppia estrazione;
- budget starvation;
- fonti ripetute;
- interruzione prematura della discovery;
- pubblicazione di candidati non auditati.

Regola obbligatoria:

nessun nuovo canary pagato senza:

1. root cause documentata;
2. replay che riproduce il difetto;
3. correzione generale;
4. test offline verde;
5. costo simulato;
6. checkpoint remoto;
7. staging immutabile;
8. rollback disponibile.

Massimo un canary pagato per una root cause corretta.

Se il canary fallisce, non ripeterlo identico.

======================================================================
8. AZIONE IMMEDIATA DAL CHECKPOINT 70f45bf
======================================================================

Procedi ora nel seguente ordine senza cambiare obiettivo.

FASE A — STATO E DEPLOY

1. Verifica il checkpoint locale e remoto.
2. Verifica working tree pulito.
3. Verifica runtime sicuro.
4. Distribuisci 70f45bf esclusivamente in staging immutabile.
5. Verifica:
   - release ID;
   - health;
   - hash;
   - worker spenti;
   - freni attivi;
   - rollback;
   - zero job/canary/reservation.

FASE B — REPLAY GRATUITO DEL PIANO HIRING

1. Usa il percorso --reuse-last-plan.
2. Riusa soltanto un piano hiring precedentemente validato 19/19.
3. Non eseguire una nuova compilazione LLM.
4. Il ledger compiler deve essere esattamente zero.
5. Crea nuovi:
   - search_id;
   - canary_id;
   - evaluation_id.
6. Riesegui tutti i gate sul piano riutilizzato.
7. Non riutilizzare dati transazionali, candidati o risultati del vecchio run.

FASE C — CANARY HIRING

Autorizza un solo search_id.

Esegui un solo one-shot staging con:

- worker persistenti spenti;
- zero pubblicazioni cliente;
- zero addebiti cliente;
- shadow isolation;
- cap complessivo massimo €0,125;
- requested_count=5 qualified.

Il motore deve:

- cercare careers ufficiali e ATS;
- privilegiare query regionali/locali;
- evitare SERP nazionali rumorose;
- filtrare prima portali, enti e enterprise fuori target;
- preservare sottodomini careers;
- promuovere l’URL ufficiale soltanto quando è realmente aziendale;
- raccogliere pool raw adattivo;
- eseguire resolver, audit e lifecycle;
- continuare finché qualified_count=5 o il cap/fonti sono esauriti.

Per ciascuno dei 5 qualified mostra:

- azienda;
- dominio ufficiale;
- tipo e dimensione;
- vacancy;
- ruolo;
- data/freshness;
- fonte;
- URL;
- estratto di evidenza;
- segnale canonico;
- target fit;
- why-now;
- contatto pubblico;
- costo;
- lifecycle stage.

Non contare Tecno 3, Aquila Prem, IFM, Sibeg o qualsiasi altro nome come
valido soltanto perché già apparso in una traccia.

Devono superare nuovamente tutti i gate.

Se ottieni 5 qualified:

- mantienili in shadow;
- non pubblicarli ai clienti;
- esegui verifica puntuale dei dati;
- misura precisione;
- prepara il gate da 20.

Se ottieni meno di 5:

- quarantina il run;
- non eseguire un altro canary;
- mostra il funnel:
  discovered
  → raw
  → unique
  → resolved
  → audited
  → evidence verified
  → qualified;
- aggrega i rejection code;
- identifica un solo gate predominante;
- correggilo tramite replay offline.

======================================================================
9. SECONDO ARCHETIPO OBBLIGATORIO
======================================================================

Dopo aver superato il canary hiring, valida un secondo percorso indipendente:

WEBSITE / DIGITAL SIGNAL MODE

Percorso:

query utente
→ discovery aziende
→ dominio ufficiale
→ scansione sito
→ segnali tecnologici
→ criticità digitali
→ contatti
→ target fit
→ qualified lead.

Verificare deterministicamente quando possibile:

- sito assente o malfunzionante;
- errori tecnici;
- tecnologie utilizzate;
- analytics;
- tag manager;
- pixel;
- performance;
- mobile;
- HTTPS;
- SEO tecnica;
- structured data;
- canali social;
- moduli di contatto;
- e-commerce;
- freshness;
- criticità pertinenti all’offerta del seller.

Non usare l’LLM per rilevare fatti tecnici deterministici.

L’LLM può essere usato per:

- interpretazione commerciale;
- collegamento criticità → offerta;
- priorità;
- why-now;
- sintesi.

Anche questo archetipo deve produrre almeno 5 qualified reali prima di essere
considerato funzionante.

======================================================================
10. GATE DI QUALITÀ E SCALA
======================================================================

GATE 1 — PRIMO SUCCESSO REALE

- 5 lead hiring qualificati;
- non raw;
- non enterprise fuori target;
- non enti;
- dominio ed evidenza verificati;
- zero pubblicazioni cliente;
- costo entro cap.

GATE 2 — QUALITÀ

- almeno 20 lead hiring;
- almeno 20 lead website/digital;
- review umana reale;
- precisione complessiva almeno 90%;
- precisione top-tier almeno 95%;
- dominio ufficiale 100%;
- fonte e URL 100%;
- evidenza 100%;
- freshness 100%;
- nessun lead inventato;
- nessun publisher scambiato per buyer.

GATE 3 — BATCH 100

- requested_count=100;
- 100 qualified oppure esaurimento dimostrato;
- dedup globale;
- progress;
- checkpoint;
- resume;
- costo misurato;
- nessuna perdita di qualità.

GATE 4 — BATCH 500

- query sufficientemente ampia;
- più shard;
- più fonti;
- risultati progressivi;
- nessuna duplicazione;
- resume dopo interruzione;
- qualità non inferiore ai batch piccoli.

GATE 5 — BATCH 5.000

- mercato sufficientemente ampio;
- job asincrono;
- worker pool controllato;
- rate limiting;
- queue;
- lease;
- retry;
- checkpoint;
- dedup globale;
- source diversification;
- cost governor;
- risultati progressivi;
- completamento o esaurimento dimostrato.

GATE 6 — UNIVERSALITÀ

Validare almeno i seguenti archetipi con query reali:

- hiring;
- digital weakness;
- procurement;
- expansion;
- compliance;
- organizzazione/management.

Non dichiarare “qualsiasi query” finché il planner non ha dimostrato di
comporre e instradare correttamente questi archetipi.

======================================================================
11. COSTO
======================================================================

Hard target:

massimo €0,025 per lead pubblicato.

Target operativo:

€0,018–€0,021 per lead pubblicato.

La pipeline deve essere cheap-first:

1. query decomposition;
2. discovery economica;
3. blacklist;
4. dedup URL;
5. dedup entità;
6. estrazione deterministica;
7. risoluzione identità;
8. risoluzione dominio;
9. LLM soltanto sui candidati promettenti;
10. audit;
11. lifecycle;
12. publication gate.

Non:

- interrogare l’LLM due volte sulla stessa pagina;
- mandare intere pagine quando basta un estratto;
- usare modelli costosi per filtrare portali;
- consumare tutto il budget su una sola lane;
- pagare una nuova compilazione quando un piano identico è già validato.

Tracciare i costi per:

- compiler;
- search;
- fetch;
- extraction;
- domain resolution;
- enrichment;
- qualification;
- publication.

======================================================================
12. SICUREZZA NON NEGOZIABILE
======================================================================

Mantenere sempre:

- brake globale;
- kill switch;
- binding esatto al search_id;
- worker persistenti spenti nei canary;
- shadow isolation;
- hard cost cap;
- reservation;
- ledger;
- idempotenza;
- publish + charge atomici;
- RLS;
- rollback;
- zero doppia pubblicazione;
- zero doppio addebito;
- zero reservation orfana;
- zero esposizione cliente durante i test.

Non aggiungere altri framework di sicurezza quando quelli esistenti coprono
già il rischio corrente.

======================================================================
13. DISCIPLINA DI ESECUZIONE
======================================================================

Non effettuare scansioni complete del repository ripetutamente.

Usa ricerche mirate.

Non eseguire l’intera test suite dopo ogni modifica se è sufficiente una
regressione mirata.

Esegui la suite completa soltanto:

- prima di una release;
- dopo una modifica trasversale;
- prima di dichiarare un gate.

Ogni modifica deve avere:

- root cause;
- fixture;
- test;
- commit atomico;
- push verificato;
- deploy immutabile quando necessario.

Non accumulare modifiche non correlate.

Non lasciare file temporanei.

Non inserire credenziali nel repository, nei log o nelle fixture.

Non chiedere conferma per operazioni sicure e reversibili.

Fermati soltanto per:

- disattivare il brake globale;
- aprire il sistema a clienti reali;
- pubblicare o addebitare clienti;
- superare il cap autorizzato;
- eseguire operazioni irreversibili;
- credenziali mancanti;
- review realmente umana.

======================================================================
14. REPORT OPERATIVO
======================================================================

Non produrre lunghi resoconti durante il lavoro.

Ad ogni checkpoint riporta soltanto:

- cosa è stato verificato;
- modifica effettuata;
- test eseguiti;
- risultato reale;
- costo;
- SHA;
- release;
- prossimo passo.

Dopo ogni canary mostra obbligatoriamente:

- requested_count;
- discovered_count;
- raw_candidate_count;
- unique_entity_count;
- resolved_count;
- audited_count;
- evidence_verified_count;
- qualified_count;
- rejected_count;
- published_count;
- costo totale;
- costo per qualified;
- rejection code aggregati;
- lead completi.

Il numero di test verdi non sostituisce i lead reali.

La quantità di codice modificato non sostituisce il valore commerciale.

======================================================================
15. DEFINIZIONE DI STAGE 1
======================================================================

Stage 1 può essere dichiarato soltanto quando:

- il nuovo motore v5 è realmente usato;
- hiring produce risultati reali;
- website/digital produce risultati reali;
- almeno 20 lead per archetipo sono verificati;
- domini ufficiali ed evidenze sono corrette;
- contatti sono presenti quando pubblicamente disponibili;
- progress e resume funzionano;
- publication canary interno passa;
- publication e charge sono exactly-once;
- costo è misurato;
- deploy live è protetto;
- allowlist iniziale è disponibile;
- zero difetti critici conosciuti esistono nei percorsi abilitati.

Non dichiarare Stage 1 sulla base di 5 raw candidate.

======================================================================
16. DEFINIZIONE DI 10/10
======================================================================

Non affermare che MIRAX è 10/10 perché:

- compila;
- ha molti test;
- non perde crediti;
- ha rollback;
- ha un canary con pochi risultati.

La valutazione 10/10 richiede prove misurabili su:

- comprensione query;
- precisione;
- valore commerciale;
- volume;
- fonti;
- evidenza;
- freshness;
- domini;
- contatti;
- deduplicazione;
- costi;
- stabilità;
- recovery;
- sicurezza;
- multi-verticalità;
- review umana reale.

I 7 giudizi legacy non validano il nuovo motore.

Non chiamare classificazioni AI “human review”.

La certificazione finale richiede il gold set v5 completo:

- 160 v5;
- 25 legacy;
- 15 adversariali reali;
- totale 200;
- tutti realmente revisionati da persone.

Frase finale autorizzata esclusivamente dopo tutti i gate:

OBIETTIVO RAGGIUNTO: MIRAX è production-ready 10/10 rispetto a tutti i
criteri misurabili definiti nel Master Implementation Plan, con qualità,
volume, costi, sicurezza e canary multi-verticali verificati end-to-end.

======================================================================
17. ORDINE DI ESECUZIONE DA ADESSO
======================================================================

Esegui senza deviazioni:

1. verifica checkpoint 70f45bf;
2. deploy staging;
3. replay gratuito del piano hiring;
4. canary hiring requested_count=5 qualified;
5. verifica puntuale dei lead;
6. replay e correzione offline se fallisce;
7. hiring batch=20;
8. website/digital canary=5;
9. website/digital batch=20;
10. publication canary interno;
11. batch=100;
12. batch=500;
13. stress test=5.000;
14. archetipi procurement, expansion, compliance e management;
15. review umana;
16. apertura controllata;
17. produzione generale.

Non cambiare questo ordine salvo impedimento tecnico dimostrato.

Non tornare su audit generali già superati.

Non aggiungere nuove feature non necessarie.

Non dichiarare successo prima dei risultati reali.

Continua ora autonomamente dal checkpoint 70f45bf.
La prossima evidenza richiesta non è un altro report:
sono lead v5 qualificati, completi e verificabili.

