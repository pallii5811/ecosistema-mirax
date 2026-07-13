import assert from 'node:assert/strict'

const categories = [
  ['commercialista', 'servizi fiscali e contabili', 'complessità amministrativa'],
  ['broker assicurativo', 'coperture assicurative aziendali', 'rischio operativo'],
  ['agenzia web', 'siti web e advertising', 'presenza digitale debole'],
  ['software house', 'software su misura e automazioni', 'processi manuali'],
  ['consulente HR', 'recruiting e organizzazione', 'aumento delle assunzioni'],
  ['fornitore fotovoltaico', 'impianti solari', 'investimenti energetici'],
  ['consulente cybersecurity', 'servizi di sicurezza informatica', 'esposizione cyber'],
  ['fornitore ERP CRM', 'gestionali ERP e CRM', 'sistemi frammentati'],
  ['consulente sicurezza sul lavoro', 'formazione e sicurezza sul lavoro', 'nuovi addetti operativi'],
  ['fornitore logistico', 'servizi logistici B2B', 'crescita delle spedizioni'],
  ['formatore aziendale', 'formazione business', 'nuovi team e competenze'],
  ['consulente ambientale', 'compliance ambientale', 'nuovi obblighi e impianti'],
  ['impresa di pulizie', 'pulizie e facility management', 'nuove sedi operative'],
  ['venditore macchinari industriali', 'macchinari e attrezzature', 'espansione produttiva'],
  ['consulente B2B quantistico', 'ottimizzazione quantistica dei processi', 'problemi complessi di pianificazione'],
] as const

async function main() {
  process.env.UQE_ANTHROPIC_ENABLED = '0'
  const { buildMiraxQueryPlan } = await import('../src/lib/uqe/mirax-query-planner')
  let checked = 0
  for (const [seller, offer, signal] of categories) {
  const queries = [
    `Sono un ${seller} e cerco clienti per ${offer}`,
    `Vendo ${offer}: quali PMI potrebbero comprarli adesso?`,
    `Mi servono clienti per ${offer}`,
    `sn un ${seller}, trovmi pmi ke anno bisogno di ${offer}`,
    `Sono un ${seller}: trovami buyer in Lombardia`,
    `Cerco micro e piccole imprese locali a cui vendere ${offer}`,
    `Trova prospect per ${offer}, escludi multinazionali, brand famosi e concorrenti`,
    `Cerco aziende con segnali recenti di ${signal} a cui vendere ${offer}`,
    `I sell ${offer}; find small Italian business buyers with recent purchase signals`,
  ]
    for (const query of queries) {
      const plan = await buildMiraxQueryPlan(query)
      assert.equal(plan.search_strategy, 'organic_web_search', `${seller}: ${query}`)
      assert.notEqual(plan.search_strategy, 'fallback', `${seller}: unexpected fallback`)
      assert.equal(plan.original_query, query)
      assert.equal(
        plan.sector.toLowerCase().includes(seller.toLowerCase()),
        false,
        `${seller}: seller category leaked into buyer target (${plan.sector})`,
      )
      assert.equal(plan.required_signals.length > 0, true, `${seller}: no observable signal plan`)
      checked += 1
    }
  }

  for (const query of [
    'Trovami aziende esclusivamente a Milano ma escludi Milano',
    'Cerco aziende con meno di 10 dipendenti e almeno 250 dipendenti',
  ]) {
    const plan = await buildMiraxQueryPlan(query)
    assert.equal(plan.search_strategy, 'fallback')
    checked += 1
  }

  assert.equal(checked, 137)
  console.log(`Commercial multi-vertical query matrix: ${checked}/137 OK across 15 seller categories`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
