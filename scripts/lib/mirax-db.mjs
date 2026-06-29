/**
 * Connessione Postgres diretta a Supabase dev (pooler).
 * Usata da apply-mirax e test schema/RLS quando REST fetch fallisce.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEV_REF = 'ktspchugdwpqvxhmysap'

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

export function loadMiraxDbPassword() {
  for (const p of [path.join(ROOT, '.env.local'), path.join(ROOT, '.env.ecosistema.secrets')]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.ECOSISTEMA_DB_PASSWORD) return env.ECOSISTEMA_DB_PASSWORD
  }
  return process.env.ECOSISTEMA_DB_PASSWORD
}

export async function connectMiraxDb() {
  const password = loadMiraxDbPassword()
  if (!password) throw new Error('Manca ECOSISTEMA_DB_PASSWORD in .env.local')

  const endpoints = [
    { host: `db.${DEV_REF}.supabase.co`, port: 5432, user: 'postgres' },
    { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: `postgres.${DEV_REF}` },
    { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 6543, user: `postgres.${DEV_REF}` },
  ]

  let lastErr
  for (const ep of endpoints) {
    const client = new Client({
      host: ep.host,
      port: ep.port,
      user: ep.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    try {
      await client.connect()
      return client
    } catch (e) {
      lastErr = e
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error('Nessun endpoint DB raggiungibile')
}

/** Errori benigni quando una migration è già stata applicata. */
export function isBenignMigrationError(message) {
  return /already exists|duplicate key|does not exist.*drop|multiple primary keys/i.test(message)
}
