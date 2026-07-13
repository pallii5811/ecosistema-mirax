import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function parseEnv(text){const out={}; for(const line of text.split(/\r?\n/)){const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<1)continue; out[t.slice(0,i).trim()]=t.slice(i+1).trim()} return out}
function loadEnv(){for(const p of [path.join(ROOT,'.env.local'),path.join(ROOT,'.env.ecosistema.secrets')]){if(!fs.existsSync(p))continue; const env=parseEnv(fs.readFileSync(p,'utf8')); if(env.NEXT_PUBLIC_SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY)return env} throw new Error('env')}
const env=loadEnv()
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { parseCommercialIntent } = await import('../src/lib/signal-intent/parse-commercial-intent.ts')
const { executeCommercialUniverseSearch } = await import('../src/lib/universe/agentic-search.ts')
const q='aziende a Taormina'
const intent=await parseCommercialIntent(q)
console.log('INTENT', JSON.stringify(intent,null,2))
const res=await executeCommercialUniverseSearch(sb,intent,{limit:5})
console.log('RESULTS', res.total, res.results.map(r=>r.azienda||r.nome))
