#!/usr/bin/env node
/**
 * Genera CREATE TABLE da OpenAPI PostgREST (dump prod).
 * Uso: node scripts/generate-schema-from-openapi.mjs [path-to-openapi.json]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = process.argv[2] || path.join(ROOT, 'tmp/prod-openapi.json')
const out = path.join(ROOT, 'db/bootstrap/generated_schema.sql')

const openapi = JSON.parse(fs.readFileSync(input, 'utf8'))
const defs = openapi.definitions || {}

function pgType(prop) {
  const fmt = (prop.format || '').toLowerCase()
  if (prop.type === 'array' && fmt.includes('uuid')) return 'uuid[]'
  if (prop.type === 'array' && fmt === 'text') return 'text[]'
  if (fmt.includes('uuid')) return 'uuid'
  if (fmt === 'integer' || fmt === 'bigint') return 'integer'
  if (fmt === 'numeric' || fmt === 'double precision') return 'numeric'
  if (fmt === 'boolean') return 'boolean'
  if (fmt === 'jsonb' || fmt === 'json') return 'jsonb'
  if (fmt.includes('timestamp')) return 'timestamptz'
  if (fmt === 'text' || fmt === 'character varying') return 'text'
  if (prop.type === 'integer') return 'integer'
  if (prop.type === 'number') return 'numeric'
  if (prop.type === 'boolean') return 'boolean'
  if (prop.type === 'object') return 'jsonb'
  return 'text'
}

function defaultSql(prop) {
  const d = prop.default
  if (d === undefined) return ''
  if (d === 'now()') return ' default now()'
  if (d === 'gen_random_uuid()') return ' default gen_random_uuid()'
  if (typeof d === 'string' && d.includes('timezone(')) return ' default timezone(\'utc\', now())'
  if (typeof d === 'number') return ` default ${d}`
  if (typeof d === 'string') return ` default '${d.replace(/'/g, "''")}'`
  return ''
}

const lines = [
  '-- Auto-generated from production PostgREST OpenAPI. Review before apply.',
  '-- Run on EMPTY Supabase dev project, then db/migrations/*.sql',
  'create extension if not exists "pgcrypto";',
  '',
]

const skip = new Set(['spatial_ref_sys'])

for (const [table, def] of Object.entries(defs)) {
  if (skip.has(table) || !def.properties) continue
  const pkCols = []
  const cols = []
  for (const [name, prop] of Object.entries(def.properties)) {
    const req = (def.required || []).includes(name)
    const pk = String(prop.description || '').includes('Primary Key')
    if (pk) pkCols.push(name)
    let line = `  ${name} ${pgType(prop)}${defaultSql(prop)}`
    if (!pk && req) line += ' not null'
    cols.push(line)
  }
  if (pkCols.length === 1) {
    const idx = cols.findIndex((c) => c.startsWith(`  ${pkCols[0]} `))
    if (idx >= 0 && !cols[idx].includes('primary key')) cols[idx] += ' primary key'
  } else if (pkCols.length > 1) {
    cols.push(`  primary key (${pkCols.join(', ')})`)
  }
  lines.push(`create table if not exists public.${table} (`)
  lines.push(cols.join(',\n'))
  lines.push(');')
  lines.push('')
}

lines.push('-- profiles.id should match auth.users (create via trigger or manual signup)')
lines.push('alter table public.profiles enable row level security;')
lines.push('alter table public.searches enable row level security;')
lines.push('alter table public.leads enable row level security;')
lines.push('alter table public.lists enable row level security;')
lines.push('alter table public.lead_pipeline enable row level security;')
lines.push('alter table public.environments enable row level security;')
lines.push('')

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, lines.join('\n'))
console.log('Wrote', out, `(${Object.keys(defs).length} tables)`)
