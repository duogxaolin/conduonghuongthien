import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import {
  normalizeAnalyticsNocEvent,
  type AnalyticsNocComponent,
  type AnalyticsNocErrorCode,
  type AnalyticsNocEventType,
  type AnalyticsNocSeverity,
  type AnalyticsNocStatus,
} from '../utils/analytics-noc'

const MAX_NOC_DURATION_MS = 86_400_000

export type AnalyticsNocRecord = {
  eventType: AnalyticsNocEventType
  severity: AnalyticsNocSeverity
  component: AnalyticsNocComponent
  status: AnalyticsNocStatus
  errorCode?: AnalyticsNocErrorCode
  details?: unknown
  durationMs?: number
}

export type PersistedAnalyticsNocRecord = ReturnType<typeof buildPersistedAnalyticsNocRecord>
export type StoreAnalyticsNocRecord = (record: PersistedAnalyticsNocRecord) => Promise<void>

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>
}

export function utcMinuteStart(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('invalid NOC event time')
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
  ))
}

export function formatUtcDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ')
}

function normalizeDuration(value: unknown) {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_NOC_DURATION_MS) {
    throw new Error('invalid NOC duration')
  }
  return Number(value)
}

export function buildPersistedAnalyticsNocRecord(record: AnalyticsNocRecord, now = new Date()) {
  const normalized = normalizeAnalyticsNocEvent(record)
  const durationMs = normalizeDuration(record.durationMs)
  return {
    bucketStart: formatUtcDateTime(utcMinuteStart(now)),
    ...normalized,
    durationCount: durationMs === null ? 0 : 1,
    durationTotalMs: durationMs ?? 0,
    durationMaxMs: durationMs ?? 0,
  }
}

export async function storeAnalyticsNocRecord(record: PersistedAnalyticsNocRecord, executor: SqlExecutor = getDb()) {
  await executor.execute(sql`
    INSERT INTO analytics_noc_minute_aggregates
      (bucket_start, event_type, severity, component, status, error_code, event_count,
       duration_count, duration_total_ms, duration_max_ms, details_json)
    VALUES
      (${record.bucketStart}, ${record.eventType}, ${record.severity}, ${record.component},
       ${record.status}, ${record.errorCode}, 1, ${record.durationCount},
       ${record.durationTotalMs}, ${record.durationMaxMs}, ${record.detailsJson})
    ON DUPLICATE KEY UPDATE
      event_count = event_count + 1,
      duration_count = duration_count + VALUES(duration_count),
      duration_total_ms = duration_total_ms + VALUES(duration_total_ms),
      duration_max_ms = GREATEST(duration_max_ms, VALUES(duration_max_ms)),
      details_json = VALUES(details_json)
  `)
}

export async function recordAnalyticsNocBestEffort(
  record: AnalyticsNocRecord,
  options: { now?: Date; store?: StoreAnalyticsNocRecord } = {},
): Promise<void> {
  try {
    const persisted = buildPersistedAnalyticsNocRecord(record, options.now)
    await (options.store || storeAnalyticsNocRecord)(persisted)
  } catch {
    // NOC is deliberately best-effort. Never recurse, log request data, or affect callers.
  }
}
