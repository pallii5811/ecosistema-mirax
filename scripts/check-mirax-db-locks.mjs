import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('set statement_timeout=10000')
  const result = await client.query(`
    select pid, state, wait_event_type, wait_event, left(query, 160) query
    from pg_stat_activity
    where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
    order by query_start
  `)
  console.log(JSON.stringify(result.rows, null, 2))
  if (process.argv.includes('--terminate-idle')) {
    for (const row of result.rows) {
      if (row.state === 'idle in transaction') {
        const terminated = await client.query('select pg_terminate_backend($1) ok', [row.pid])
        console.log(`terminated pid=${row.pid} ok=${terminated.rows[0]?.ok === true}`)
      }
    }
  }
} finally {
  await client.end()
}
