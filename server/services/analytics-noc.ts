import mysql, { type Pool } from 'mysql2/promise'
import { normalizeAnalyticsNocEvent } from '../utils/analytics-noc'

export type AnalyticsNocConnection = Pick<Pool, 'query'>

export type RecordAnalyticsNocInput = Parameters<typeof normalizeAnalyticsNocEvent>[0] & {
  occurredAt?: Date
  eventCount?: number
  durationMs?: number
}

function runtimeValue(name: string) {
  const runtime = typeof globalThis.useRuntimeConfig === 'function' ? globalThis.useRuntimeConfig() : undefined
  return runtime?.[name]
}

export function createAnalyticsNocPool(): Pool {
  return mysql.createPool({
    host: runtimeValue('dbHost') || process.env.DB_HOST || '127.0.0.1',
    port: Number(runtimeValue('dbPort') || process.env.DB_PORT || 3306),
    user: runtimeValue('dbUser') || process.env.DB_USER || 'root',
    password: runtimeValue('dbPassword') || process.env.DB_PASSWORD || '',
    database: runtimeValue('dbName') || process.env.DB_NAME || 'cdkt_admin',
    waitForConnections: true,
    connectionLimit: 2,
    timezone: '+00:00',
  })
}

function boundedCounter(value: unknown, fallback: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : fallback
}

export async function recordAnalyticsNoc(input: RecordAnalyticsNocInput, connection?: AnalyticsNocConnection): Promise<void> {
  const event = normalizeAnalyticsNocEvent(input)
  const occurredAt = input.occurredAt || new Date()
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('invalid NOC occurrence time')
  const bucketStart = new Date(Math.floor(occurredAt.getTime() / 60_000) * 60_000)
  const eventCount = boundedCounter(input.eventCount, 1, 1_000_000_000)
  if (eventCount < 1) throw new Error('invalid NOC event count')
  const durationMs = boundedCounter(input.durationMs, 0, 4_294_967_295)
  const durationCount = durationMs > 0 ? eventCount : 0
  const durationTotalMs = Math.min(9_007_199_254_740_991, durationMs * durationCount)

  const pool = connection ? null : createAnalyticsNocPool()
  const db = connection || pool!
  try {
    await db.query(
      `INSERT INTO analytics_noc_minute_aggregates
        (bucket_start, event_type, severity, component, status, error_code, event_count,
         duration_count, duration_total_ms, duration_max_ms, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         event_count = LEAST(event_count + VALUES(event_count), 1000000000),
         duration_count = LEAST(duration_count + VALUES(duration_count), 1000000000),
         duration_total_ms = LEAST(duration_total_ms + VALUES(duration_total_ms), 9007199254740991),
         duration_max_ms = GREATEST(duration_max_ms, VALUES(duration_max_ms)),
         details_json = VALUES(details_json),
         updated_at = CURRENT_TIMESTAMP`,
      [
        bucketStart,
        event.eventType,
        event.severity,
        event.component,
        event.status,
        event.errorCode,
        eventCount,
        durationCount,
        durationTotalMs,
        durationMs,
        event.detailsJson,
      ],
    )
  } finally {
    if (pool) await pool.end()
  }
}

export async function bestEffortRecordAnalyticsNoc(input: RecordAnalyticsNocInput, connection?: AnalyticsNocConnection): Promise<boolean> {
  try {
    await recordAnalyticsNoc(input, connection)
    return true
  } catch {
    // NOC persistence failures are intentionally swallowed to prevent recursive logging.
    return false
  }
}
