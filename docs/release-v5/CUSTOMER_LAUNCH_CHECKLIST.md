# MIRAX controlled customer launch checklist

## Gate obbligatori prima dello Stage 1

- [ ] Human review 200/200 completata e adjudicated.
- [ ] Published precision >= 90% con Wilson 95% CI riportato.
- [ ] Top-tier precision >= 95% con denominatore sufficiente.
- [ ] Evidence, official domain, source URL e observation date coverage = 100%.
- [ ] Public contact coverage >= 90% sul denominatore publicly available.
- [ ] Cold/warm weighted cost per published lead <= €0,025.
- [ ] Intent canary v5 PASS.
- [ ] Canary 10/10 verticali PASS.
- [ ] Zero intermediate customer-visible lead, duplicate publication/charge/refund, lost credit e orphan reservation.
- [x] Failure injection PASS.
- [x] Safety soak PASS.
- [x] Rollback rehearsal PASS.
- [x] Kill switch verificato attivo.

## Stage 1

- Solo account interno.
- Un worker, bassa concorrenza, shadow off solo per publication transaction test approvato.
- Budget hard per search e alert costo/qualità.
- Review giornaliera di ledger, publication e feedback.

## Stage 2

- 5–10 account controllati solo dopo più ricerche Stage 1 verdi.
- Stop automatico su qualunque threshold violation.

## Stage 3

- Espansione graduale; kill switch, reconciliation e quality sampling restano permanenti.
