import type { Pool } from 'mysql2/promise'
import { normalizeAnalyticsNocEvent } from '../utils/analytics-noc'
import { sharedUtcQueryConnection } from '../utils/utc-query'

export type AnalyticsNocConnection = Pick<Pool, 'query'>

export type RecordAnalyticsNocInput = Parameters<typeof normalizeAnalyticsNocEvent>[0] & {
  occurredAt?: Date
  eventCount?: number
  durationMs?: number
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

  // Pool dùng chung qua adapter UTC (`bucket_start` lưu theo UTC) — trước đây mỗi
  // lượt ghi mở rồi đóng một pool riêng `+00:00`, tức một lần bắt tay TCP mỗi
  // sự kiện. Xem `server/utils/utc-query.ts`.
  const db = connection || sharedUtcQueryConnection()
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
