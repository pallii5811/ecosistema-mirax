/**
 * Phase 3.1 — Neo4j driver singleton (Vercel-safe).
 * Solo server-side: API routes / Server Actions.
 */
import neo4j, { type Driver, type Record as Neo4jRecord } from 'neo4j-driver'

const globalForNeo4j = globalThis as unknown as { __miraxNeo4jDriver?: Driver }

export type Neo4jAccessMode = 'READ' | 'WRITE'

export class Neo4jConfigError extends Error {
  constructor(message = 'Neo4j non configurato (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD)') {
    super(message)
    this.name = 'Neo4jConfigError'
  }
}

function readNeo4jEnv(): { uri: string; username: string; password: string } {
  const uri = process.env.NEO4J_URI?.trim()
  const username = (process.env.NEO4J_USERNAME ?? process.env.NEO4J_USER)?.trim()
  const password = process.env.NEO4J_PASSWORD?.trim()
  if (!uri || !username || !password) {
    throw new Neo4jConfigError()
  }
  return { uri, username, password }
}

/** Aura DB name is often a hash (e.g. 3304bbc5), not the default "neo4j". */
export function getNeo4jDatabase(override?: string): string {
  const db = (override ?? process.env.NEO4J_DATABASE ?? 'neo4j').trim()
  return db || 'neo4j'
}

export function isNeo4jConfigured(): boolean {
  try {
    readNeo4jEnv()
    return true
  } catch {
    return false
  }
}

/** Singleton driver — riusato tra invocazioni serverless. */
export function getNeo4jDriver(): Driver {
  if (globalForNeo4j.__miraxNeo4jDriver) {
    return globalForNeo4j.__miraxNeo4jDriver
  }

  const { uri, username, password } = readNeo4jEnv()
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 15_000,
    maxTransactionRetryTime: 15_000,
  })

  globalForNeo4j.__miraxNeo4jDriver = driver
  return driver
}

/** Chiude il pool (test / shutdown). */
export async function closeNeo4jDriver(): Promise<void> {
  if (globalForNeo4j.__miraxNeo4jDriver) {
    await globalForNeo4j.__miraxNeo4jDriver.close()
    globalForNeo4j.__miraxNeo4jDriver = undefined
  }
}

function serializeNeo4jValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (neo4j.isInt(value)) {
    const n = value.toNumber()
    return Number.isSafeInteger(n) ? n : value.toString()
  }
  if (neo4j.isDate(value) || neo4j.isDateTime(value) || neo4j.isLocalDateTime(value) || neo4j.isTime(value)) {
    return value.toString()
  }
  if (neo4j.isNode(value)) {
    return {
      _type: 'node',
      elementId: value.elementId,
      labels: value.labels,
      properties: serializeRecordProperties(value.properties),
    }
  }
  if (neo4j.isRelationship(value)) {
    return {
      _type: 'relationship',
      elementId: value.elementId,
      type: value.type,
      startNodeElementId: value.startNodeElementId,
      endNodeElementId: value.endNodeElementId,
      properties: serializeRecordProperties(value.properties),
    }
  }
  if (neo4j.isPath(value)) {
    return {
      _type: 'path',
      start: serializeNeo4jValue(value.start),
      end: serializeNeo4jValue(value.end),
      length: value.length,
      segments: value.segments.map((seg) => ({
        start: serializeNeo4jValue(seg.start),
        relationship: serializeNeo4jValue(seg.relationship),
        end: serializeNeo4jValue(seg.end),
      })),
    }
  }
  if (Array.isArray(value)) {
    return value.map(serializeNeo4jValue)
  }
  if (typeof value === 'object') {
    return serializeRecordProperties(value as Record<string, unknown>)
  }
  return String(value)
}

function serializeRecordProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(props)) {
    out[key] = serializeNeo4jValue(val)
  }
  return out
}

function recordToJson(record: Neo4jRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const key of record.keys) {
    row[String(key)] = serializeNeo4jValue(record.get(key))
  }
  return row
}

export type RunNeo4jQueryOptions = {
  cypher: string
  params?: Record<string, unknown>
  mode?: Neo4jAccessMode
  database?: string
}

export type RunNeo4jQueryResult = {
  records: Record<string, unknown>[]
  summary: {
    queryType: string
    counters: Record<string, number>
    resultAvailableAfter: number | null
    resultConsumedAfter: number | null
  }
}

/** Esegue Cypher parametrizzato e serializza il risultato in JSON plain. */
export async function runNeo4jQuery(options: RunNeo4jQueryOptions): Promise<RunNeo4jQueryResult> {
  const { cypher, params = {}, mode = 'READ', database } = options
  const db = getNeo4jDatabase(database)
  const driver = getNeo4jDriver()
  const session = driver.session({
    database: db,
    defaultAccessMode: mode === 'WRITE' ? neo4j.session.WRITE : neo4j.session.READ,
  })

  try {
    const result = await session.run(cypher, params)
    const counters = result.summary.counters.updates()
    return {
      records: result.records.map(recordToJson),
      summary: {
        queryType: result.summary.queryType,
        counters: {
          nodesCreated: counters.nodesCreated,
          nodesDeleted: counters.nodesDeleted,
          relationshipsCreated: counters.relationshipsCreated,
          relationshipsDeleted: counters.relationshipsDeleted,
          propertiesSet: counters.propertiesSet,
          labelsAdded: counters.labelsAdded,
          labelsRemoved: counters.labelsRemoved,
          indexesAdded: counters.indexesAdded,
          indexesRemoved: counters.indexesRemoved,
          constraintsAdded: counters.constraintsAdded,
          constraintsRemoved: counters.constraintsRemoved,
        },
        resultAvailableAfter: result.summary.resultAvailableAfter?.toNumber?.() ?? null,
        resultConsumedAfter: result.summary.resultConsumedAfter?.toNumber?.() ?? null,
      },
    }
  } catch (e) {
    console.error('[neo4j-client] query failed', {
      database: db,
      mode,
      error: e instanceof Error ? e.message : e,
    })
    throw e
  } finally {
    await session.close()
  }
}

export async function verifyNeo4jConnectivity(): Promise<boolean> {
  const db = getNeo4jDatabase()
  const driver = getNeo4jDriver()
  const session = driver.session({ database: db })
  try {
    await session.run('RETURN 1 AS ok')
    return true
  } catch (e) {
    console.error('[neo4j-client] connectivity failed', {
      database: db,
      error: e instanceof Error ? e.message : e,
    })
    return false
  } finally {
    await session.close()
  }
}
