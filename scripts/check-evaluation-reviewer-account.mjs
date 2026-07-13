#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'
const email = String(process.argv[2] || '').trim().toLowerCase()
if (!email || !email.includes('@')) process.exit(1)
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const result = await client.query('select count(*)::int count from auth.users where lower(email)=$1', [email])
  const count = Number(result.rows[0].count)
  console.log(JSON.stringify({ account_exists: count === 1, matches: count }))
  if (count !== 1) process.exitCode = 2
} finally { await client.end() }
