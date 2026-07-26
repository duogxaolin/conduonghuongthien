import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from '../db/schema'

let _db: ReturnType<typeof drizzle> | null = null
let _pool: mysql.Pool | null = null

export function getDb() {
  if (_db) return _db

  const config = typeof globalThis.useRuntimeConfig === 'function' ? globalThis.useRuntimeConfig() : ({} as any)

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
  _db = drizzle(pool, { schema, mode: 'default' })
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
