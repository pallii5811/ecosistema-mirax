#!/usr/bin/env node
/**
 * Validazione sintattica basilare della migration Universe.
 * Non sostituisce psql, ma intercetta errori strutturali evidenti.
 * Run: node scripts/test-universe-sql-syntax.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('db/migrations/2026_07_02_universe_entities.sql', 'utf8')

// 1. Bilanciamento parentesi
let depth = 0
for (const ch of sql) {
  if (ch === '(') depth++
  if (ch === ')') depth--
  assert.ok(depth >= 0, 'Parentesi chiuse senza apertura')
}
assert.equal(depth, 0, 'Parentesi non bilanciate')
console.log('✓ parentesi bilanciate')

// 2. Statement terminano con ; (tranne commenti e whitespace finale)
const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith('--'))
assert.ok(statements.length > 0, 'Nessuno statement SQL trovato')
console.log(`✓ ${statements.length} statement rilevati`)

// 3. Verifica tabelle create
const createdTables = []
const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi
let m
while ((m = tableRegex.exec(sql)) !== null) {
  createdTables.push(m[1])
}
const expectedTables = [
  'universe_entities',
  'universe_entity_aliases',
  'universe_observations',
  'universe_relationships',
  'universe_events',
  'universe_user_context',
]
for (const t of expectedTables) {
  assert.ok(createdTables.includes(t), `Tabella non creata: ${t}`)
  console.log(`✓ CREATE TABLE ${t}`)
}

// 4. Verifica foreign keys referenzino tabelle esistenti
const fkRegex = /REFERENCES\s+(\w+)\s*\(/gi
const referencedTables = new Set()
while ((m = fkRegex.exec(sql)) !== null) {
  referencedTables.add(m[1])
}
for (const t of referencedTables) {
  if (t === 'auth.users') continue
  assert.ok(createdTables.includes(t), `Foreign key verso tabella non creata: ${t}`)
  console.log(`✓ FK verso ${t}`)
}

// 5. Verifica indici chiave
const expectedIndexes = [
  'idx_universe_entities_type_city',
  'idx_observations_entity_attr_time',
  'idx_relationships_source_type',
  'idx_universe_events_entity_type_time',
]
for (const idx of expectedIndexes) {
  assert.ok(sql.includes(idx), `Indice mancante nella migration: ${idx}`)
  console.log(`✓ indice ${idx}`)
}

// 6. Verifica funzioni helper
const expectedFunctions = [
  'universe_latest_observation',
  'universe_related_entities',
  'universe_resolve_entity_by_alias',
]
for (const fn of expectedFunctions) {
  assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${fn}`), `Funzione helper mancante: ${fn}`)
  console.log(`✓ funzione ${fn}`)
}

console.log('\n[test-universe-sql-syntax] OK')
