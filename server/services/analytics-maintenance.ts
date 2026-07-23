import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import {
  ANALYTICS_RETENTION_BOUNDS,
  ANALYTICS_RETENTION_DEFAULTS,
  parseBoundedAnalyticsInteger,
  resolveAnalyticsRetentionConfig,
} from '../utils/analytics-config'
import {
  normalizeAnalyticsNocEvent,
  type AnalyticsNocErrorCode,
  type AnalyticsNocEventType,
  type AnalyticsNocSeverity,
  type AnalyticsNocStatus,
} from '../utils/analytics-noc'

export type MaintenanceOptions = {
  now?: Date
  catchUpDays?: number
  rawRetentionDays?: number
  aggregateRetentionDays?: number
  liveRetentionHours?: number
  nocRetentionDays?: number
  rawBatchSize?: number
  aggregateBatchSize?: number
  liveBatchSize?: number
  dedupBatchSize?: number
  nocBatchSize?: number
  maxPurgeBatches?: number
  pageLimit?: number
  dimensionLimit?: number
  connection?: Pool
}

export type MaintenanceResult = {
  status: 'success' | 'warning' | 'locked' | 'failed'
  processedDays: string[]
  purgedRaw: number
  purgedAggregates: number
  purgedLiveBuckets: number
  purgedDedupRows: number
  purgedNocRows: number
  lastAggregatedDay: string | null
  stale: boolean
  message?: string
}

type PurgeResult = {
  count: number
  bounded: boolean
}

type NocOutcome = {
  eventType: AnalyticsNocEventType
  severity: AnalyticsNocSeverity
  status: AnalyticsNocStatus
  errorCode?: AnalyticsNocErrorCode
  durationMs?: number
  details?: Record<string, number | boolean | AnalyticsNocErrorCode>
}

const LOCK_NAME = 'cdkt:analytics:maintenance'
const MAX_CATCH_UP_DAYS = 14
const MAX_PURGE_BATCHES = 1_000
const DIMENSIONS = ['source_category', 'device_class', 'country_code', 'region_code'] as const

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function runtimeAnalytics() {
  const runtime = typeof globalThis.useRuntimeConfig === 'function' ? globalThis.useRuntimeConfig() : undefined
  const analytics = runtime?.analytics || {}
  const envRetention = resolveAnalyticsRetentionConfig(process.env)

  return {
    liveRetentionHours: parseBoundedAnalyticsInteger(
      'ANALYTICS_LIVE_RETENTION_HOURS',
      analytics.liveRetentionHours,
      envRetention.liveRetentionHours,
      ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.min,
      ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.max,
    ),
    nocRetentionDays: parseBoundedAnalyticsInteger(
      'ANALYTICS_NOC_RETENTION_DAYS',
      analytics.nocRetentionDays,
      envRetention.nocRetentionDays,
      ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.min,
      ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.max,
    ),
    rawRetentionDays: boundedInteger(analytics.rawRetentionDays ?? process.env.ANALYTICS_RAW_RETENTION_DAYS, 14, 1, 30),
    aggregateRetentionDays: boundedInteger(analytics.aggregateRetentionDays ?? process.env.ANALYTICS_AGGREGATE_RETENTION_DAYS, 762, 30, 3650),
    freshnessThresholdHours: boundedInteger(analytics.freshnessThresholdHours ?? process.env.ANALYTICS_FRESHNESS_THRESHOLD_HOURS, 48, 1, 168),
  }
}

export function createAnalyticsPool(): Pool {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cdkt_admin', waitForConnections: true,
    connectionLimit: 2, timezone: '+00:00',
  })
}

export function utcDay(date: Date) { return date.toISOString().slice(0, 10) }
export function shiftUtcDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return utcDay(date)
}

export function normalizeAggregatePath(path: string) {
  const normalized = path.split(/[?#]/, 1)[0].trim()
  return normalized && normalized.startsWith('/') && normalized.length <= 512 ? normalized : '/other'
}

export type AggregateBucket = { value: string; pageViews: number; visitorTokens: Set<string> }
export function capAggregateBuckets(rows: AggregateBucket[], limit: number) {
  const existingOther = rows.find(row => row.value === 'other')
  const named = rows
    .filter(row => row.value !== 'other')
    .sort((a, b) => b.pageViews - a.pageViews || a.value.localeCompare(b.value))
  const needsOther = Boolean(existingOther) || named.length > limit
  if (!needsOther) return named

  const namedLimit = Math.max(0, limit - 1)
  const kept = named.slice(0, namedLimit)
  const overflow = named.slice(namedLimit)
  const mergedOther = [existingOther, ...overflow].filter((row): row is AggregateBucket => Boolean(row))
  return [...kept, {
    value: 'other',
    pageViews: mergedOther.reduce((sum, row) => sum + row.pageViews, 0),
    visitorTokens: new Set(mergedOther.flatMap(row => [...row.visitorTokens])),
  }]
}

async function aggregateDay(connection: PoolConnection, day: string, pageLimit: number, dimensionLimit: number, workerToken: string) {
  await connection.beginTransaction()
  try {
    const [events] = await connection.query<RowDataPacket[]>(
      'SELECT path, visitor_token, source_category, device_class, country_code, region_code FROM analytics_page_view_events WHERE event_day = ? ORDER BY id', [day])
    const pages = new Map<string, AggregateBucket>()
    const dimensions = new Map<string, Map<string, AggregateBucket>>()
    for (const event of events) {
      const token = String(event.visitor_token)
      const path = normalizeAggregatePath(String(event.path))
      const page = pages.get(path) || { value: path, pageViews: 0, visitorTokens: new Set<string>() }
      page.pageViews += 1; page.visitorTokens.add(token); pages.set(path, page)
      for (const dimension of DIMENSIONS) {
        const raw = event[dimension]
        if (raw === null || raw === undefined || !String(raw).trim()) continue
        const value = String(raw).trim().slice(0, 128)
        const values = dimensions.get(dimension) || new Map<string, AggregateBucket>()
        const bucket = values.get(value) || { value, pageViews: 0, visitorTokens: new Set<string>() }
        bucket.pageViews += 1; bucket.visitorTokens.add(token); values.set(value, bucket); dimensions.set(dimension, values)
      }
    }
    await connection.query('DELETE FROM analytics_daily_dimensions WHERE day = ?', [day])
    await connection.query('DELETE FROM analytics_daily_pages WHERE day = ?', [day])
    await connection.query('DELETE FROM analytics_daily_traffic WHERE day = ?', [day])
    await connection.query('INSERT INTO analytics_daily_traffic (day, page_views, daily_unique_visitors) VALUES (?, ?, ?)', [day, events.length, new Set(events.map(event => String(event.visitor_token))).size])
    for (const page of capAggregateBuckets([...pages.values()], pageLimit)) {
      await connection.query('INSERT INTO analytics_daily_pages (day, path, page_views, daily_unique_visitors) VALUES (?, ?, ?, ?)', [day, page.value, page.pageViews, page.visitorTokens.size])
    }
    for (const [dimension, values] of dimensions) {
      for (const bucket of capAggregateBuckets([...values.values()], dimensionLimit)) {
        await connection.query('INSERT INTO analytics_daily_dimensions (day, dimension, value, page_views, daily_unique_visitors) VALUES (?, ?, ?, ?, ?)', [day, dimension, bucket.value, bucket.pageViews, bucket.visitorTokens.size])
      }
    }
    const [[snapshot]] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total_users, COALESCE(SUM(is_active = 1), 0) AS active_users FROM users')
    await connection.query('INSERT INTO analytics_daily_admin_users (day, total_users, active_users) VALUES (?, ?, ?)', [day, Number(snapshot.total_users), Number(snapshot.active_users)])
    await connection.query(`INSERT INTO analytics_maintenance_runs (day, status, started_at, completed_at, event_count, error_summary, worker_token)
      VALUES (?, 'complete', UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, NULL, ?)
      ON DUPLICATE KEY UPDATE status = 'complete', completed_at = UTC_TIMESTAMP(), event_count = VALUES(event_count), error_summary = NULL, worker_token = VALUES(worker_token)`, [day, events.length, workerToken])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    const summary = (error instanceof Error ? error.message : 'aggregation failed').replace(/[\r\n]/g, ' ').slice(0, 480)
    await connection.query(`INSERT INTO analytics_maintenance_runs (day, status, started_at, completed_at, event_count, error_summary, worker_token)
      VALUES (?, 'failed', UTC_TIMESTAMP(), NULL, 0, ?, ?)
      ON DUPLICATE KEY UPDATE status = 'failed', completed_at = NULL, error_summary = VALUES(error_summary), worker_token = VALUES(worker_token)`, [day, summary, workerToken])
    throw error
  }
}

async function purgeInBatches(
  connection: PoolConnection,
  statement: string,
  params: unknown[],
  batchSize: number,
  maxBatches: number,
): Promise<PurgeResult> {
  let count = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const [result] = await connection.query(statement, [...params, batchSize])
    const affected = Number((result as { affectedRows?: number }).affectedRows || 0)
    count += affected
    if (affected < batchSize) return { count, bounded: false }
  }
  return { count, bounded: true }
}

function utcMinute(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), 0, 0,
  ))
}

function retentionCutoff(now: Date, milliseconds: number) {
  return new Date(now.getTime() - milliseconds)
}

async function emitNocBestEffort(connection: PoolConnection, now: Date, outcome: NocOutcome) {
  try {
    const normalized = normalizeAnalyticsNocEvent({
      eventType: outcome.eventType,
      severity: outcome.severity,
      component: outcome.eventType === 'retention_cleanup' ? 'retention' : 'maintenance',
      status: outcome.status,
      errorCode: outcome.errorCode,
      details: outcome.details,
    })
    const durationMs = Number.isSafeInteger(outcome.durationMs)
      ? Math.min(86_400_000, Math.max(0, Number(outcome.durationMs)))
      : 0
    await connection.query(`INSERT INTO analytics_noc_minute_aggregates
      (bucket_start, event_type, severity, component, status, error_code, event_count, duration_count, duration_total_ms, duration_max_ms, details_json)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE event_count = event_count + 1,
        duration_count = duration_count + VALUES(duration_count),
        duration_total_ms = duration_total_ms + VALUES(duration_total_ms),
        duration_max_ms = GREATEST(duration_max_ms, VALUES(duration_max_ms)),
        details_json = COALESCE(VALUES(details_json), details_json)`, [
      utcMinute(now), normalized.eventType, normalized.severity, normalized.component,
      normalized.status, normalized.errorCode, durationMs > 0 ? 1 : 0, durationMs, durationMs, normalized.detailsJson,
    ])
  } catch {
    // NOC persistence is best effort. Never recursively emit a NOC event for this failure.
  }
}

async function purgeExpiredLiveBuckets(connection: PoolConnection, now: Date, config: {
  liveRetentionHours: number
  liveBatchSize: number
  maxPurgeBatches: number
}) {
  const cutoff = utcMinute(retentionCutoff(now, config.liveRetentionHours * 60 * 60 * 1000))
  return purgeInBatches(connection,
    'DELETE FROM analytics_live_minute_buckets WHERE bucket_start < ? LIMIT ?', [cutoff], config.liveBatchSize, config.maxPurgeBatches)
}

async function purgeExpiredDedupRows(connection: PoolConnection, now: Date, config: {
  liveRetentionHours: number
  dedupBatchSize: number
  maxPurgeBatches: number
}) {
  const cutoff = utcMinute(retentionCutoff(now, config.liveRetentionHours * 60 * 60 * 1000))
  return purgeInBatches(connection,
    'DELETE FROM analytics_live_deduplication WHERE bucket_start < ? LIMIT ?', [cutoff], config.dedupBatchSize, config.maxPurgeBatches)
}

async function purgeExpiredNocRows(connection: PoolConnection, now: Date, config: {
  nocRetentionDays: number
  nocBatchSize: number
  maxPurgeBatches: number
}) {
  const cutoff = retentionCutoff(now, config.nocRetentionDays * 24 * 60 * 60 * 1000)
  return purgeInBatches(connection,
    'DELETE FROM analytics_noc_minute_aggregates WHERE bucket_start < ? LIMIT ?', [cutoff], config.nocBatchSize, config.maxPurgeBatches)
}

export async function runAnalyticsMaintenance(options: MaintenanceOptions = {}): Promise<MaintenanceResult> {
  const config = runtimeAnalytics()
  const now = options.now || new Date()
  const startedAt = Date.now()
  const catchUpDays = boundedInteger(options.catchUpDays ?? process.env.ANALYTICS_CATCH_UP_DAYS, 3, 1, MAX_CATCH_UP_DAYS)
  const pageLimit = boundedInteger(options.pageLimit ?? process.env.ANALYTICS_PAGE_CARDINALITY_LIMIT, 100, 1, 500)
  const dimensionLimit = boundedInteger(options.dimensionLimit ?? process.env.ANALYTICS_DIMENSION_CARDINALITY_LIMIT, 50, 1, 200)
  const defaultBatchSize = boundedInteger(options.aggregateBatchSize ?? process.env.ANALYTICS_PURGE_BATCH_SIZE, 500, 1, 5000)
  const rawBatchSize = boundedInteger(options.rawBatchSize ?? process.env.ANALYTICS_PURGE_BATCH_SIZE, defaultBatchSize, 1, 5000)
  const aggregateBatchSize = boundedInteger(options.aggregateBatchSize ?? process.env.ANALYTICS_PURGE_BATCH_SIZE, defaultBatchSize, 1, 5000)
  const liveBatchSize = boundedInteger(options.liveBatchSize, aggregateBatchSize, 1, 5000)
  const dedupBatchSize = boundedInteger(options.dedupBatchSize, liveBatchSize, 1, 5000)
  const nocBatchSize = boundedInteger(options.nocBatchSize, aggregateBatchSize, 1, 5000)
  const maxPurgeBatches = boundedInteger(options.maxPurgeBatches, MAX_PURGE_BATCHES, 1, MAX_PURGE_BATCHES)
  const rawRetentionDays = boundedInteger(options.rawRetentionDays, config.rawRetentionDays, 1, 30)
  const aggregateRetentionDays = boundedInteger(options.aggregateRetentionDays, config.aggregateRetentionDays, 30, 3650)
  const liveRetentionHours = parseBoundedAnalyticsInteger(
    'ANALYTICS_LIVE_RETENTION_HOURS', options.liveRetentionHours, config.liveRetentionHours,
    ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.min, ANALYTICS_RETENTION_BOUNDS.liveRetentionHours.max,
  )
  const nocRetentionDays = parseBoundedAnalyticsInteger(
    'ANALYTICS_NOC_RETENTION_DAYS', options.nocRetentionDays, config.nocRetentionDays,
    ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.min, ANALYTICS_RETENTION_BOUNDS.nocRetentionDays.max,
  )
  const pool = options.connection || createAnalyticsPool()
  const connection = await pool.getConnection()
  const workerToken = randomUUID()
  let lockAcquired = false

  const emptyResult = (status: MaintenanceResult['status'], message?: string): MaintenanceResult => ({
    status, processedDays: [], purgedRaw: 0, purgedAggregates: 0,
    purgedLiveBuckets: 0, purgedDedupRows: 0, purgedNocRows: 0,
    lastAggregatedDay: null, stale: status !== 'locked', message,
  })

  try {
    const [[lock]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME])
    if (Number(lock.acquired) !== 1) {
      await emitNocBestEffort(connection, now, {
        eventType: 'maintenance_lock_contention', severity: 'warning', status: 'locked', errorCode: 'lock_unavailable',
        details: { reasonCode: 'lock_unavailable' },
      })
      return emptyResult('locked', 'maintenance lock unavailable')
    }
    lockAcquired = true

    const processedDays: string[] = []
    let aggregationFailed = false
    let retentionFailed = false
    let retentionBounded = false
    let purgedRaw = 0
    let purgedAggregates = 0
    let purgedLiveBuckets = 0
    let purgedDedupRows = 0
    let purgedNocRows = 0

    const yesterday = shiftUtcDay(utcDay(now), -1)
    try {
      for (let offset = catchUpDays - 1; offset >= 0; offset -= 1) {
        const day = shiftUtcDay(yesterday, -offset)
        await aggregateDay(connection, day, pageLimit, dimensionLimit, workerToken)
        processedDays.push(day)
      }
    } catch {
      // Raw events and daily rows stay untouched by retention when aggregation fails.
      aggregationFailed = true
    }

    if (!aggregationFailed) {
      try {
        const rawCutoff = retentionCutoff(now, rawRetentionDays * 24 * 60 * 60 * 1000)
        const raw = await purgeInBatches(connection,
          `DELETE e FROM analytics_page_view_events e INNER JOIN analytics_maintenance_runs m
           ON m.day = e.event_day AND m.status = 'complete' WHERE e.occurred_at < ? LIMIT ?`, [rawCutoff], rawBatchSize, maxPurgeBatches)
        purgedRaw = raw.count
        retentionBounded ||= raw.bounded

        const aggregateCutoff = shiftUtcDay(utcDay(now), -aggregateRetentionDays)
        for (const table of ['analytics_daily_dimensions', 'analytics_daily_pages', 'analytics_daily_traffic', 'analytics_daily_admin_users', 'analytics_maintenance_runs']) {
          const result = await purgeInBatches(connection, `DELETE FROM ${table} WHERE day < ? LIMIT ?`, [aggregateCutoff], aggregateBatchSize, maxPurgeBatches)
          purgedAggregates += result.count
          retentionBounded ||= result.bounded
        }
      } catch {
        retentionFailed = true
      }
    }

    if (!aggregationFailed) {
      try {
        const purged = await purgeExpiredLiveBuckets(connection, now, { liveRetentionHours, liveBatchSize, maxPurgeBatches })
        purgedLiveBuckets = purged.count
        retentionBounded ||= purged.bounded
      } catch {
        retentionFailed = true
      }

      try {
        const purged = await purgeExpiredDedupRows(connection, now, { liveRetentionHours, dedupBatchSize, maxPurgeBatches })
        purgedDedupRows = purged.count
        retentionBounded ||= purged.bounded
      } catch {
        retentionFailed = true
      }
    }

    // NOC retention is intentionally independent: operational telemetry remains
    // purgeable even when aggregation, raw, daily, or live retention fails.
    try {
      const purged = await purgeExpiredNocRows(connection, now, { nocRetentionDays, nocBatchSize, maxPurgeBatches })
      purgedNocRows = purged.count
      retentionBounded ||= purged.bounded
    } catch {
      retentionFailed = true
    }

    let lastAggregatedDay: string | null = null
    let stale = true
    try {
      const [[fresh]] = await connection.query<RowDataPacket[]>('SELECT MAX(day) AS last_day FROM analytics_maintenance_runs WHERE status = \'complete\'')
      lastAggregatedDay = fresh.last_day ? utcDay(new Date(fresh.last_day)) : null
      stale = !lastAggregatedDay || now.getTime() - new Date(`${lastAggregatedDay}T23:59:59Z`).getTime() > config.freshnessThresholdHours * 3600000
    } catch {
      retentionFailed = true
    }

    const status: MaintenanceResult['status'] = aggregationFailed
      ? 'failed'
      : retentionFailed || retentionBounded || stale ? 'warning' : 'success'
    await emitNocBestEffort(connection, now, {
      eventType: aggregationFailed ? 'maintenance_failure' : status === 'warning' ? 'maintenance_warning' : 'maintenance_complete',
      severity: aggregationFailed ? 'error' : status === 'warning' ? 'warning' : 'info',
      status: aggregationFailed ? 'failure' : status === 'warning' ? 'warning' : 'complete',
      errorCode: aggregationFailed ? 'maintenance_failed' : retentionFailed || retentionBounded ? 'retention_warning' : 'none',
      durationMs: Date.now() - startedAt,
      details: aggregationFailed
        ? { processedDays: processedDays.length, reasonCode: 'maintenance_failed' }
        : { processedDays: processedDays.length, stale },
    })
    await emitNocBestEffort(connection, now, {
      eventType: 'retention_cleanup', severity: retentionBounded || retentionFailed ? 'warning' : 'info',
      durationMs: Date.now() - startedAt,
      status: retentionBounded || retentionFailed ? 'warning' : 'complete',
      errorCode: retentionBounded || retentionFailed ? 'retention_warning' : 'none',
      details: { purgedLiveBuckets, purgedDedupRows, purgedNocRows, liveRetentionHours, nocRetentionDays },
    })

    return {
      status, processedDays, purgedRaw, purgedAggregates, purgedLiveBuckets,
      purgedDedupRows, purgedNocRows, lastAggregatedDay, stale,
      ...(aggregationFailed ? { message: 'maintenance failed' } : {}),
    }
  } catch {
    await emitNocBestEffort(connection, now, {
      eventType: 'maintenance_failure', severity: 'error', status: 'failure', errorCode: 'maintenance_failed',
      durationMs: Date.now() - startedAt,
      details: { processedDays: 0, reasonCode: 'maintenance_failed' },
    })
    return emptyResult('failed', 'maintenance failed')
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => undefined)
    connection.release()
    if (!options.connection) await pool.end()
  }
}

export const ANALYTICS_RETENTION_CONFIG_DEFAULTS = ANALYTICS_RETENTION_DEFAULTS
