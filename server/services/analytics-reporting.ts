import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import {
  computeFreshness,
  encodeAnalyticsNocCursor,
  getAnalyticsReportingConfig,
  reportingErrorCode,
  reportingWindowMinutes,
  safeAnalyticsCounter,
  safeAnalyticsRatio,
  type AnalyticsDimension,
  type AnalyticsNocCursor,
  type AnalyticsRange,
} from '../utils/analytics-reporting'
import type { AnalyticsLiveScopeType } from '../utils/analytics-live'
import {
  isAnalyticsNocComponent,
  isAnalyticsNocEventType,
  isAnalyticsNocSeverity,
  isAnalyticsNocStatus,
  normalizeAnalyticsNocErrorCode,
  serializeAnalyticsNocDetails,
} from '../utils/analytics-noc'
import { bestEffortRecordAnalyticsNoc } from './analytics-noc'

export type ReportingConnection = Pick<Pool, 'query'>
export type LiveReportingConnection = ReportingConnection

export type AnalyticsMetricRow = {
  value: string
  pageViews: number
  summedDailyUniqueVisitors: number
}

export type AnalyticsSummary = {
  range: AnalyticsRange
  totals: {
    pageViews: number
    summedDailyUniqueVisitors: number
    uniqueVisitorSemantics: 'summed_daily_uniques'
  }
  traffic: Array<{ day: string; pageViews: number; dailyUniqueVisitors: number }>
  adminUsers: { snapshotDay: string; totalUsers: number; activeUsers: number } | null
  freshness: { lastAggregatedDay: string | null; stale: boolean }
}

export type AnalyticsDrillDown = {
  range: AnalyticsRange
  items: AnalyticsMetricRow[]
  pagination: { page: number; perPage: number; total: number; totalPages: number }
}

export type AnalyticsLivePoint = {
  bucketStart: string
  pageViews: number
  approximateUniqueVisitors: number
  uniqueVisitorSemantics: 'approximate_minute_token'
}

export type AnalyticsLiveMeta = {
  generatedAt: string
  latestBucketStart: string | null
  nextPollAfterSeconds: 15
  freshness: 'current' | 'stale' | 'empty'
  stale: boolean
}

export type AnalyticsLiveSummary = {
  windowMinutes: 5 | 15 | 30 | 60
  points: AnalyticsLivePoint[]
  fiveMinuteTotals: {
    pageViews: number
    approximateUniqueVisitors: number
    eventsPerMinute: number
    uniqueVisitorSemantics: 'approximate_minute_token'
  }
  meta: AnalyticsLiveMeta
}

export type AnalyticsBreakdownRow = {
  rank: number
  value: string
  pageViews: number
  approximateUniqueVisitors: number
  share: number
  uniqueVisitorSemantics: 'approximate_minute_token'
}

export type AnalyticsLiveBreakdown = {
  scope: Exclude<AnalyticsLiveScopeType, 'total'>
  windowMinutes: 5 | 15 | 30 | 60
  rows: AnalyticsBreakdownRow[]
  totalPageViews: number
  meta: AnalyticsLiveMeta
}

export type AnalyticsNocRow = {
  id: number
  bucketStart: string
  eventType: string
  severity: string
  component: string
  status: string
  errorCode: string
  eventCount: number
  duration: { count: number; averageMs: number; maxMs: number }
  details: Record<string, number | boolean | string> | null
}

export type AnalyticsNocReport = {
  rows: AnalyticsNocRow[]
  nextCursor: string | null
  meta: AnalyticsLiveMeta
}

function runtimeConfig() {
  return typeof globalThis.useRuntimeConfig === 'function' ? globalThis.useRuntimeConfig() : undefined
}

function runtimeValue(name: string) {
  return runtimeConfig()?.[name]
}

export function createAnalyticsReportingPool(): Pool {
  return mysql.createPool({
    host: runtimeValue('dbHost') || process.env.DB_HOST || '127.0.0.1',
    port: Number(runtimeValue('dbPort') || process.env.DB_PORT || 3306),
    user: runtimeValue('dbUser') || process.env.DB_USER || 'root',
    password: runtimeValue('dbPassword') || process.env.DB_PASSWORD || '',
    database: runtimeValue('dbName') || process.env.DB_NAME || 'cdkt_admin',
    waitForConnections: true,
    connectionLimit: 4,
    timezone: '+00:00',
  })
}

function numberValue(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function dayValue(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10)
  return null
}

function dateTimeValue(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value !== 'string') return null
  const date = new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isFinite(date.getTime()) ? date : null
}

function serializedDateTime(value: unknown): string | null {
  return dateTimeValue(value)?.toISOString() || null
}

async function withReportingConnection<T>(connection: ReportingConnection | undefined, work: (db: ReportingConnection) => Promise<T>) {
  if (connection) return work(connection)
  const pool = createAnalyticsReportingPool()
  try {
    return await work(pool)
  } finally {
    await pool.end()
  }
}

export async function getAnalyticsSummary(
  range: AnalyticsRange,
  options: { connection?: ReportingConnection; now?: Date; freshnessThresholdHours?: number } = {},
): Promise<AnalyticsSummary> {
  return withReportingConnection(options.connection, async (db) => {
    const [trafficRows] = await db.query<RowDataPacket[]>(
      `SELECT day, page_views, daily_unique_visitors
       FROM analytics_daily_traffic
       WHERE day BETWEEN ? AND ?
       ORDER BY day ASC`,
      [range.start, range.end],
    )
    const [snapshotRows] = await db.query<RowDataPacket[]>(
      `SELECT day, total_users, active_users
       FROM analytics_daily_admin_users
       WHERE day BETWEEN ? AND ?
       ORDER BY day DESC
       LIMIT 1`,
      [range.start, range.end],
    )
    const [freshnessRows] = await db.query<RowDataPacket[]>(
      `SELECT MAX(day) AS last_aggregated_day
       FROM analytics_maintenance_runs
       WHERE status = 'complete'`,
    )

    const traffic = trafficRows.map(row => ({
      day: dayValue(row.day)!,
      pageViews: numberValue(row.page_views),
      dailyUniqueVisitors: numberValue(row.daily_unique_visitors),
    })).filter(row => row.day !== null)
    const snapshot = snapshotRows[0]
    const lastAggregatedDay = dayValue(freshnessRows[0]?.last_aggregated_day)
    const config = getAnalyticsReportingConfig()

    return {
      range,
      totals: {
        pageViews: traffic.reduce((sum, row) => sum + row.pageViews, 0),
        summedDailyUniqueVisitors: traffic.reduce((sum, row) => sum + row.dailyUniqueVisitors, 0),
        uniqueVisitorSemantics: 'summed_daily_uniques',
      },
      traffic,
      adminUsers: snapshot ? {
        snapshotDay: dayValue(snapshot.day)!,
        totalUsers: numberValue(snapshot.total_users),
        activeUsers: numberValue(snapshot.active_users),
      } : null,
      freshness: computeFreshness(lastAggregatedDay, options.now || new Date(), options.freshnessThresholdHours ?? config.freshnessThresholdHours),
    }
  })
}

async function getDrillDown(
  table: 'analytics_daily_pages' | 'analytics_daily_dimensions',
  valueColumn: 'path' | 'value',
  range: AnalyticsRange,
  options: { connection?: ReportingConnection; page: number; perPage: number; filter: string | null; dimension?: AnalyticsDimension },
): Promise<AnalyticsDrillDown> {
  return withReportingConnection(options.connection, async (db) => {
    const dimensionClause = table === 'analytics_daily_dimensions' ? ' AND dimension = ?' : ''
    const filterClause = options.filter ? ` AND ${valueColumn} = ?` : ''
    const params: unknown[] = [range.start, range.end]
    if (options.dimension) params.push(options.dimension)
    if (options.filter) params.push(options.filter)
    const [countRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (
         SELECT ${valueColumn} FROM ${table}
         WHERE day BETWEEN ? AND ?${dimensionClause}${filterClause}
         GROUP BY ${valueColumn}
       ) AS bounded_items`, params,
    )
    const offset = (options.page - 1) * options.perPage
    const [itemRows] = await db.query<RowDataPacket[]>(
      `SELECT ${valueColumn} AS value, SUM(page_views) AS page_views,
              SUM(daily_unique_visitors) AS summed_daily_unique_visitors
       FROM ${table}
       WHERE day BETWEEN ? AND ?${dimensionClause}${filterClause}
       GROUP BY ${valueColumn}
       ORDER BY (${valueColumn} = 'other') ASC, page_views DESC, ${valueColumn} ASC
       LIMIT ? OFFSET ?`, [...params, options.perPage, offset],
    )
    const total = numberValue(countRows[0]?.total)
    return {
      range,
      items: itemRows.map(row => ({ value: String(row.value), pageViews: numberValue(row.page_views), summedDailyUniqueVisitors: numberValue(row.summed_daily_unique_visitors) })),
      pagination: { page: options.page, perPage: options.perPage, total, totalPages: Math.ceil(total / options.perPage) },
    }
  })
}

export function getAnalyticsPages(range: AnalyticsRange, options: { connection?: ReportingConnection; page: number; perPage: number; path: string | null }) {
  return getDrillDown('analytics_daily_pages', 'path', range, { ...options, filter: options.path })
}

export function getAnalyticsDimension(range: AnalyticsRange, options: { connection?: ReportingConnection; page: number; perPage: number; filter: string | null; dimension: AnalyticsDimension }) {
  return getDrillDown('analytics_daily_dimensions', 'value', range, options)
}

function liveWindowBounds(now: Date, windowMinutes: number) {
  const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  return { start: new Date(end.getTime() - windowMinutes * 60_000), end }
}

function liveMeta(now: Date, latestBucketStart: Date | null, hasRows: boolean): AnalyticsLiveMeta {
  const ageMs = latestBucketStart ? now.getTime() - latestBucketStart.getTime() : Number.POSITIVE_INFINITY
  return {
    generatedAt: now.toISOString(),
    latestBucketStart: latestBucketStart?.toISOString() || null,
    nextPollAfterSeconds: 15,
    freshness: !hasRows ? 'empty' : ageMs <= 120_000 ? 'current' : 'stale',
    stale: Boolean(hasRows && ageMs > 120_000),
  }
}

function completeLivePoints(rows: RowDataPacket[], now: Date, windowMinutes: number): AnalyticsLivePoint[] {
  if (rows.length === 0) return []
  const byTime = new Map<string, RowDataPacket>()
  let latestObservedTime = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const bucketStart = serializedDateTime(row.bucket_start)
    if (!bucketStart) continue
    byTime.set(bucketStart, row)
    latestObservedTime = Math.max(latestObservedTime, Date.parse(bucketStart))
  }
  if (byTime.size === 0 || !Number.isFinite(latestObservedTime)) return []
  const bounds = liveWindowBounds(now, windowMinutes)
  const safeEndTime = Math.min(bounds.end.getTime() - 60_000, latestObservedTime)
  const points: AnalyticsLivePoint[] = []
  for (let time = bounds.start.getTime(); time <= safeEndTime; time += 60_000) {
    const bucketStart = new Date(time).toISOString()
    const row = byTime.get(bucketStart)
    points.push({
      bucketStart,
      pageViews: numberValue(row?.page_views),
      approximateUniqueVisitors: numberValue(row?.approximate_unique_visitors),
      uniqueVisitorSemantics: 'approximate_minute_token',
    })
  }
  return points
}

async function emitReportingNoc(
  eventType: 'reporting_success' | 'reporting_failure',
  details: { windowMinutes: number; rowCount?: number; reasonCode?: 'query_failed' | 'unknown' },
  injectedConnection?: ReportingConnection,
) {
  if (injectedConnection) return
  await bestEffortRecordAnalyticsNoc(eventType === 'reporting_success'
    ? {
        eventType,
        severity: 'info',
        component: 'reporting',
        status: 'success',
        errorCode: 'none',
        details: { windowMinutes: reportingWindowMinutes(details.windowMinutes), rowCount: Math.min(1_000_000_000, Math.max(0, details.rowCount || 0)) },
      }
    : {
        eventType,
        severity: 'error',
        component: 'reporting',
        status: 'failure',
        errorCode: details.reasonCode || 'unknown',
        details: { windowMinutes: reportingWindowMinutes(details.windowMinutes), reasonCode: details.reasonCode || 'unknown' },
      })
}

export async function recordAnalyticsReportingOutcome(
  input: { success: boolean; windowMinutes: number; rowCount?: number; reasonCode?: 'query_failed' | 'unknown' },
  injectedConnection?: ReportingConnection,
) {
  await emitReportingNoc(input.success ? 'reporting_success' : 'reporting_failure', input, injectedConnection)
}

export async function getAnalyticsLiveSummary(
  windowMinutes: 5 | 15 | 30 | 60,
  options: { connection?: LiveReportingConnection; now?: Date } = {},
): Promise<AnalyticsLiveSummary> {
  const now = options.now || new Date()
  const bounds = liveWindowBounds(now, windowMinutes)
  try {
    const result = await withReportingConnection(options.connection, async db => {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT bucket_start, page_views, approximate_unique_visitors
         FROM analytics_live_minute_buckets
         WHERE scope_type = 'total' AND bucket_start >= ? AND bucket_start < ?
         ORDER BY bucket_start ASC
         LIMIT 60`, [bounds.start, bounds.end],
      )
      const points = completeLivePoints(rows, now, windowMinutes)
      const lastFive = points.slice(-5)
      const totals = lastFive.reduce((sum, point) => ({
        pageViews: sum.pageViews + point.pageViews,
        approximateUniqueVisitors: sum.approximateUniqueVisitors + point.approximateUniqueVisitors,
      }), { pageViews: 0, approximateUniqueVisitors: 0 })
      const latest = rows.reduce<Date | null>((value, row) => dateTimeValue(row.bucket_start) || value, null)
      return {
        windowMinutes,
        points,
        fiveMinuteTotals: {
          ...totals,
          eventsPerMinute: Number((totals.pageViews / 5).toFixed(3)),
          uniqueVisitorSemantics: 'approximate_minute_token' as const,
        },
        meta: liveMeta(now, latest, rows.length > 0),
      }
    })
    await emitReportingNoc('reporting_success', { windowMinutes, rowCount: result.points.length }, options.connection)
    return result
  } catch (error) {
    await emitReportingNoc('reporting_failure', { windowMinutes, reasonCode: reportingErrorCode(error) }, options.connection)
    throw error
  }
}

export async function getAnalyticsLiveBreakdown(
  scope: Exclude<AnalyticsLiveScopeType, 'total'>,
  windowMinutes: 5 | 15 | 30 | 60,
  options: { connection?: LiveReportingConnection; now?: Date; limit?: number; value?: string | null } = {},
): Promise<AnalyticsLiveBreakdown> {
  const now = options.now || new Date()
  const bounds = liveWindowBounds(now, windowMinutes)
  const limit = Math.min(50, Math.max(1, options.limit || 10))
  try {
    const result = await withReportingConnection(options.connection, async db => {
      const params: unknown[] = [bounds.start, bounds.end, scope]
      const valueClause = options.value ? ' AND scope_value = ?' : ''
      if (options.value) params.push(options.value)
      const [summaryRows] = await db.query<RowDataPacket[]>(
        `SELECT SUM(page_views) AS total_page_views, MAX(bucket_start) AS latest_bucket_start
         FROM analytics_live_minute_buckets
         WHERE bucket_start >= ? AND bucket_start < ? AND scope_type = ?${valueClause}`, params,
      )
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT scope_value, SUM(page_views) AS page_views,
                SUM(approximate_unique_visitors) AS approximate_unique_visitors
         FROM analytics_live_minute_buckets
         WHERE bucket_start >= ? AND bucket_start < ? AND scope_type = ?${valueClause}
         GROUP BY scope_value
         ORDER BY page_views DESC, scope_value ASC
         LIMIT ?`, [...params, limit],
      )
      const totalPageViews = numberValue(summaryRows[0]?.total_page_views)
      const latest = dateTimeValue(summaryRows[0]?.latest_bucket_start)
      return {
        scope,
        windowMinutes,
        rows: rows.map((row, index) => {
          const pageViews = numberValue(row.page_views)
          return {
            rank: index + 1,
            value: String(row.scope_value || '').slice(0, 512),
            pageViews,
            approximateUniqueVisitors: numberValue(row.approximate_unique_visitors),
            share: safeAnalyticsRatio(pageViews, totalPageViews),
            uniqueVisitorSemantics: 'approximate_minute_token' as const,
          }
        }),
        totalPageViews,
        meta: liveMeta(now, latest, rows.length > 0),
      }
    })
    await emitReportingNoc('reporting_success', { windowMinutes, rowCount: result.rows.length }, options.connection)
    return result
  } catch (error) {
    await emitReportingNoc('reporting_failure', { windowMinutes, reasonCode: reportingErrorCode(error) }, options.connection)
    throw error
  }
}

function safeNocDetails(eventType: Parameters<typeof serializeAnalyticsNocDetails>[0], detailsJson: unknown) {
  if (typeof detailsJson !== 'string' || !detailsJson) return null
  try {
    const serialized = serializeAnalyticsNocDetails(eventType, JSON.parse(detailsJson))
    return serialized ? JSON.parse(serialized) as Record<string, number | boolean | string> : null
  } catch {
    return null
  }
}

function serializeNocRow(row: RowDataPacket): AnalyticsNocRow | null {
  if (!isAnalyticsNocEventType(row.event_type) || !isAnalyticsNocSeverity(row.severity) || !isAnalyticsNocComponent(row.component) || !isAnalyticsNocStatus(row.status)) return null
  const id = safeAnalyticsCounter(row.id)
  const bucketStart = serializedDateTime(row.bucket_start)
  if (id < 1 || !bucketStart) return null
  const durationCount = safeAnalyticsCounter(row.duration_count)
  return {
    id,
    bucketStart,
    eventType: row.event_type,
    severity: row.severity,
    component: row.component,
    status: row.status,
    errorCode: normalizeAnalyticsNocErrorCode(row.error_code),
    eventCount: safeAnalyticsCounter(row.event_count),
    duration: {
      count: durationCount,
      averageMs: durationCount ? Math.round(safeAnalyticsCounter(row.duration_total_ms) / durationCount) : 0,
      maxMs: safeAnalyticsCounter(row.duration_max_ms),
    },
    details: safeNocDetails(row.event_type, row.details_json),
  }
}

function configuredNocRetentionDays() {
  const runtimeValue = runtimeConfig()?.analytics?.nocRetentionDays ?? process.env.ANALYTICS_NOC_RETENTION_DAYS
  const parsed = Number(runtimeValue)
  return Number.isSafeInteger(parsed) && parsed >= 7 && parsed <= 90 ? parsed : 30
}

export async function getAnalyticsNocReport(
  options: { connection?: LiveReportingConnection; now?: Date; limit?: number; cursor?: AnalyticsNocCursor | null } = {},
): Promise<AnalyticsNocReport> {
  const now = options.now || new Date()
  const cutoff = new Date(now.getTime() - configuredNocRetentionDays() * 86_400_000)
  const limit = Math.min(100, Math.max(1, options.limit || 20))
  try {
    const result = await withReportingConnection(options.connection, async db => {
      const cursor = options.cursor || null
      const cursorClause = cursor ? ' AND (bucket_start < ? OR (bucket_start = ? AND id < ?))' : ''
      const params = cursor ? [cutoff, cursor.bucketStart, cursor.bucketStart, cursor.id, limit + 1] : [cutoff, limit + 1]
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT id, bucket_start, event_type, severity, component, status, error_code,
                event_count, duration_count, duration_total_ms, duration_max_ms, details_json
         FROM analytics_noc_minute_aggregates
         WHERE bucket_start >= ?${cursorClause}
         ORDER BY bucket_start DESC, id DESC
         LIMIT ?`, params,
      )
      const hasNext = rows.length > limit
      const visibleSourceRows = rows.slice(0, limit)
      const safeRows = visibleSourceRows.map(serializeNocRow).filter((row): row is AnalyticsNocRow => row !== null)
      const last = hasNext ? visibleSourceRows[visibleSourceRows.length - 1] : null
      const nextCursor = last ? encodeAnalyticsNocCursor({ bucketStart: dateTimeValue(last.bucket_start)!, id: safeAnalyticsCounter(last.id) }) : null
      return {
        rows: safeRows,
        nextCursor,
        meta: liveMeta(now, safeRows.length ? new Date(safeRows[0].bucketStart) : null, safeRows.length > 0),
      }
    })
    await emitReportingNoc('reporting_success', { windowMinutes: 60, rowCount: result.rows.length }, options.connection)
    return result
  } catch (error) {
    await emitReportingNoc('reporting_failure', { windowMinutes: 60, reasonCode: reportingErrorCode(error) }, options.connection)
    throw error
  }
}
