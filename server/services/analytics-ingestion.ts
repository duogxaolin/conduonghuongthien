import { readAffectedRows } from '../utils/affected-rows'
import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { getHeader } from 'h3'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { buildMinimalPageViewRow, type MinimalPageViewRow, type TrustedGeography } from '../utils/analytics-collection'
import type { AnalyticsLiveScopeType } from '../utils/analytics-live'
import { getClientIp } from '../utils/client-ip'
import {
  formatUtcDateTime,
  recordAnalyticsNocBestEffort,
  utcMinuteStart,
  type StoreAnalyticsNocRecord,
} from './analytics-ingestion-noc'

const BOT_USER_AGENT = /bot|crawler|spider|slurp|headless/i
const MAX_LIVE_SCOPES_PER_EVENT = 6

export type AnalyticsRuntimeConfig = {
  collectionEnabled?: boolean
  hmacSecret?: string
}

export type AnalyticsEventContext = H3Event['context'] & {
  analyticsGeography?: TrustedGeography
}

export type AnalyticsLiveScope = {
  scopeType: AnalyticsLiveScopeType
  scopeValue: string
  scopeValueHash: string
}

export type StorePageView = (row: MinimalPageViewRow) => Promise<void>

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>
}

export type AnalyticsPageViewTransaction = {
  insertRaw(row: MinimalPageViewRow): Promise<void>
  insertDeduplication(bucketStart: string, visitorToken: string, scope: AnalyticsLiveScope): Promise<boolean>
  incrementBucket(bucketStart: string, scope: AnalyticsLiveScope, uniqueIncrement: 0 | 1): Promise<void>
}

export type AnalyticsPageViewTransactionStore = {
  transaction<T>(callback: (tx: AnalyticsPageViewTransaction) => Promise<T>): Promise<T>
}

type DrizzleTransactionDb = SqlExecutor & {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

/**
 * Ở đây `null` là LỖI, không phải `0` — khác các vòng dọn theo lô.
 *
 * Con số này quyết định một lượt ghi có phải bản đầu tiên của (ngày, bài, nguồn)
 * hay là một bản trùng, nên đọc "không biết" thành `0` sẽ âm thầm bỏ đúng những
 * lượt xem mà bộ khử trùng lặp tồn tại để đếm.
 */
function affectedRows(result: unknown): number {
  const value = readAffectedRows(result)
  if (value === null) throw new Error('analytics deduplication result is unavailable')
  return value
}

function hashLiveScope(scopeType: AnalyticsLiveScopeType, scopeValue: string) {
  return createHash('sha256').update(`${scopeType}\n${scopeValue}`).digest('hex')
}

export function buildAnalyticsLiveScopes(row: MinimalPageViewRow): AnalyticsLiveScope[] {
  const values: Array<[AnalyticsLiveScopeType, string | null]> = [
    ['total', ''],
    ['path', row.path],
    ['source_category', row.sourceCategory],
    ['device_class', row.deviceClass],
    ['country_code', row.countryCode],
    ['region_code', row.regionCode],
  ]
  const scopes = values
    .filter((entry): entry is [AnalyticsLiveScopeType, string] => entry[1] !== null && entry[1] !== '')
    .map(([scopeType, scopeValue]) => ({
      scopeType,
      scopeValue,
      scopeValueHash: hashLiveScope(scopeType, scopeValue),
    }))

  // The total scope deliberately has an empty value and is always first.
  scopes.unshift({ scopeType: 'total', scopeValue: '', scopeValueHash: hashLiveScope('total', '') })
  if (scopes.length > MAX_LIVE_SCOPES_PER_EVENT) throw new Error('analytics live scope limit exceeded')
  return scopes
}

function createDrizzleTransactionStore(db: DrizzleTransactionDb): AnalyticsPageViewTransactionStore {
  return {
    transaction: callback => db.transaction(async (executor) => callback({
      async insertRaw(row) {
        await executor.execute(sql`
          INSERT INTO analytics_page_view_events
            (occurred_at, event_day, path, visitor_token, source_category, device_class, country_code, region_code)
          VALUES
            (${formatUtcDateTime(row.occurredAt)}, ${row.eventDay}, ${row.path}, ${row.visitorToken},
             ${row.sourceCategory}, ${row.deviceClass}, ${row.countryCode}, ${row.regionCode})
        `)
      },
      async insertDeduplication(bucketStart, visitorToken, scope) {
        const result = await executor.execute(sql`
          INSERT IGNORE INTO analytics_live_deduplication
            (bucket_start, scope_type, scope_value_hash, visitor_token)
          VALUES
            (${bucketStart}, ${scope.scopeType}, ${scope.scopeValueHash}, ${visitorToken})
        `)
        return affectedRows(result) === 1
      },
      async incrementBucket(bucketStart, scope, uniqueIncrement) {
        await executor.execute(sql`
          INSERT INTO analytics_live_minute_buckets
            (bucket_start, scope_type, scope_value, scope_value_hash, page_views, approximate_unique_visitors)
          VALUES
            (${bucketStart}, ${scope.scopeType}, ${scope.scopeValue}, ${scope.scopeValueHash}, 1, ${uniqueIncrement})
          ON DUPLICATE KEY UPDATE
            page_views = page_views + 1,
            approximate_unique_visitors = approximate_unique_visitors + VALUES(approximate_unique_visitors),
            scope_value = VALUES(scope_value)
        `)
      },
    })),
  }
}

/**
 * One page view in one transaction: the raw event, then every dedupe row, then
 * every minute-bucket upsert — `total` first (wave2 design D8, as measured).
 *
 * Every page view upserts the same `total` bucket row for the current minute, and
 * the lock its upsert takes is held until COMMIT. In the previous order that
 * upsert came second and the ten dedupe/bucket statements after it ran while it
 * was held. Now the per-visitor dedupe rows — which no other page view waits on —
 * are all written BEFORE the first shared row is locked, so `total` is held across
 * the remaining bucket upserts only.
 *
 * **`total` stays the first bucket upsert, deliberately — not the last.** Both
 * live tables have an auto-increment surrogate PK next to their natural unique
 * key, and an `INSERT … ON DUPLICATE KEY UPDATE` there holds an X next-key lock on
 * the PK supremum until commit. With `total` first, the upsert every page view
 * shares serialises the bucket phase per minute. With `total` last (the literal
 * D8 text), each transaction takes the supremum lock on its own first, distinct,
 * bucket row and then waits for the other's: ~37 % of page views rolled back with
 * ER_LOCK_DEADLOCK under 10 concurrent requests. The previous interleaved order
 * also deadlocked once visitors repeat within a minute (a duplicate dedupe insert
 * takes a shared next-key lock while the `total` row is held); this order cut
 * that ~10× in a sustained run but not to zero — the root fix is a natural-key
 * primary key on both tables (follow-up). Numbers, the deadlock dump and the four
 * orders compared are in docs/decisions/data-layer.md; the order is pinned by
 * tests/analytics-ingestion.test.ts.
 */
export async function storeAnalyticsPageView(
  row: MinimalPageViewRow,
  store: AnalyticsPageViewTransactionStore = createDrizzleTransactionStore(getDb() as DrizzleTransactionDb),
): Promise<void> {
  // Build order: `total` first, then the dimensions.
  const scopes = buildAnalyticsLiveScopes(row)
  const bucketStart = formatUtcDateTime(utcMinuteStart(row.occurredAt))

  await store.transaction(async (tx) => {
    await tx.insertRaw(row)
    const unique: Array<0 | 1> = []
    for (const scope of scopes) {
      unique.push(await tx.insertDeduplication(bucketStart, row.visitorToken, scope) ? 1 : 0)
    }
    for (const [index, scope] of scopes.entries()) {
      await tx.incrementBucket(bucketStart, scope, unique[index]!)
    }
  })
  // The NOC aggregate is recorded by the caller (`ingestAnalyticsPageView`) after
  // this transaction has committed, never inside it.
}

export async function ingestAnalyticsPageView(options: {
  event: H3Event
  payload: unknown
  config: AnalyticsRuntimeConfig
  now?: Date
  store?: StorePageView
  storeNoc?: StoreAnalyticsNocRecord
}): Promise<'accepted' | 'disabled' | 'bot'> {
  if (options.config.collectionEnabled !== true) return 'disabled'

  const now = options.now || new Date()
  const userAgent = getHeader(options.event, 'user-agent') || ''
  if (BOT_USER_AGENT.test(userAgent)) {
    await recordAnalyticsNocBestEffort({
      eventType: 'ingestion_bot_filtered',
      severity: 'info',
      component: 'collector',
      status: 'filtered',
      errorCode: 'bot_filtered',
      details: { reasonCode: 'bot_filtered' },
    }, { now, store: options.storeNoc })
    return 'bot'
  }

  let row: MinimalPageViewRow
  try {
    row = buildMinimalPageViewRow({
      payload: options.payload,
      secret: options.config.hmacSecret,
      ip: getClientIp(options.event) || 'unknown',
      userAgent,
      now,
      trustedGeography: (options.event.context as AnalyticsEventContext).analyticsGeography,
    })
  } catch (error) {
    await recordAnalyticsNocBestEffort({
      eventType: 'ingestion_rejected',
      severity: 'warning',
      component: 'collector',
      status: 'rejected',
      errorCode: 'invalid_payload',
      details: { reasonCode: 'invalid_payload' },
    }, { now, store: options.storeNoc })
    throw error
  }

  try {
    await (options.store || storeAnalyticsPageView)(row)
  } catch (error) {
    await recordAnalyticsNocBestEffort({
      eventType: 'ingestion_rejected',
      severity: 'error',
      component: 'collector',
      status: 'failure',
      errorCode: 'transaction_failed',
      details: { reasonCode: 'transaction_failed' },
    }, { now, store: options.storeNoc })
    throw error
  }

  const scopeCount = buildAnalyticsLiveScopes(row).length
  await recordAnalyticsNocBestEffort({
    eventType: 'ingestion_accepted',
    severity: 'info',
    component: 'collector',
    status: 'accepted',
    details: { scopeCount },
  }, { now, store: options.storeNoc })
  return 'accepted'
}
