#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from '../../scripts/lib/mirax-db.mjs'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

const searchId = '1d87b4da-b51e-43e3-a754-f5ca83fff321'
if (!loadMiraxDbPassword()) process.exit(1)
const c = await connectMiraxDb()
const r = await c.query('select progress from searches where id=$1', [searchId])
const tel = (r.rows[0]?.progress?.adapter_telemetry || [])[0] || {}
const raw = tel.next_cursor || ''
const payload = raw.startsWith('hiring:v2:')
  ? JSON.parse(Buffer.from(raw.slice('hiring:v2:'.length) + '==', 'base64url').toString('utf8'))
  : {}
const out = 'backend_mirror/fixtures/hiring_search_1d87b4da_cursor.json'
fs.writeFileSync(out, JSON.stringify(payload, null, 2))
console.log('written', out, 'urls', payload.seen_urls?.length, 'offset', payload.url_offset)
await c.end()
