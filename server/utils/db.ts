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

  const config = tryRuntimeConfig() ?? {}

  const pool = mysql.createPool({
    host:     config.dbHost     || process.env.DB_HOST     || '127.0.0.1',
    port:     Number(config.dbPort || process.env.DB_PORT  || 3306),
    user:     config.dbUser     || process.env.DB_USER     || 'root',
    password: config.dbPassword || process.env.DB_PASSWORD || '',
    database: config.dbName     || process.env.DB_NAME     || 'cdkt_admin',
    waitForConnections: true,
    connectionLimit: 10,
    timezone: '+07:00',
  })

  _pool = pool
  _db = createDb(pool)
  return _db
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
