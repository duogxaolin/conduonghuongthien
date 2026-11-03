import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from '../db/schema'
import { tryRuntimeConfig } from './runtime-config'

/**
 * Derived from the call itself rather than written out, so the schema generic
 * stays attached: a bare `ReturnType<typeof drizzle>` defaults TSchema to
 * `Record<string, never>` and every `db.query.*` access loses its types.
 */
const createDb = (pool: mysql.Pool) => drizzle(pool, { schema, mode: 'default' })
export type Database = ReturnType<typeof createDb>

let _db: Database | null = null
let _pool: mysql.Pool | null = null

/**
 * The return type is annotated on purpose. Inferred, it would widen to
 * `Database | null` from the cache variable above even though every path
 * assigns before returning, and ~390 call sites would each have to null-check
 * a value that is never null.
 */
export function getDb(): Database {
  if (_db) return _db

  const pool = mysql.createPool({
    ...dbConnectionOptions(),
    waitForConnections: true,
    connectionLimit: 10,
  })

  _pool = pool
  _db = createDb(pool)
  return _db
}

/**
 * Where and how to connect — the ONE place that resolves it, for the shared pool
 * above and for the short-lived connection the ops-alert path opens and closes
 * itself (`ops-alert.ts`: it also runs inside the boot CLI `server/db/init.ts`, where
 * creating this module's pool would keep the process — and the container start —
 * alive forever). `timezone` must be the same on both: the rate-limit counters they
 * share store DATETIMEs.
 */
export function dbConnectionOptions() {
  const config = tryRuntimeConfig() ?? {}
  return {
    host:     config.dbHost     || process.env.DB_HOST     || '127.0.0.1',
    port:     Number(config.dbPort || process.env.DB_PORT  || 3306),
    user:     config.dbUser     || process.env.DB_USER     || 'root',
    password: config.dbPassword || process.env.DB_PASSWORD || '',
    database: config.dbName     || process.env.DB_NAME     || 'cdkt_admin',
    timezone: '+07:00',
  }
}

/**
 * The underlying mysql2 pool, for the few places that need plain SQL rather
 * than the query builder (the shared rate-limit counters). Returns null before
 * the first getDb() call so a caller can degrade instead of throwing.
 */
export function getPool(): mysql.Pool | null {
  if (!_pool) getDb()
  return _pool
}

/**
 * Release the pool. Only needed by the standalone CLI scripts: an open pool
 * keeps the event loop alive, so a cron job that touched the database would
 * hang after printing its result instead of exiting. The server never calls it.
 */
export async function closeDb(): Promise<void> {
  const pool = _pool
  _pool = null
  _db = null
  if (pool) await pool.end().catch(() => {})
}
