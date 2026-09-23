import { affectedRowsOrZero } from '../utils/affected-rows'
import type { Pool, PoolConnection } from 'mysql2/promise'
import { createAnalyticsPool } from './analytics-maintenance'
import { resolveDataRetentionConfig } from '../utils/data-retention-config'
import { purgeExpiredRateLimits } from '../utils/rate-limit-store'

/**
 * Purge the operational tables that hold personal data past their retention
 * window. Analytics maintenance already prunes its own nine tables; these were
 * never covered.
 *
 * Two independent conditions delete rows, in this order:
 *   1. age     — the table's timestamp older than the retention window (policy)
 *   2. row cap — rows beyond `maxRows`, oldest first (a capacity limit)
 * Age runs first so the cap only ever has to remove what a busy period added.
 * A cap alone would delete this morning's audit trail on a heavy day; age alone
 * cannot bound a table that fills faster than the window elapses.
 *
 * Deletion is batched with a LIMIT and bounded by `maxBatches`, so a first run
 * against years of accumulated rows cannot hold a long lock or fill the binlog
 * in one statement. When the bound is hit the run reports `bounded: true` and
 * the next run continues where this one stopped.
 */

export const RETENTION_TARGETS = ['activity_logs', 'submissions', 'chat_sessions', 'reader_accounts', 'livestream_sessions'] as const
export type RetentionTarget = typeof RETENTION_TARGETS[number]

/**
 * Per-table column names. Not every table calls its timestamp `created_at`, and
 * not every primary key is chronological — hardcoding either is how a purge
 * either crashes or silently deletes the wrong rows.
 *
 *   • `timestamp` is the column the retention window is measured against.
 *     `chat_sessions` uses `last_message_at`, not `started_at`: a conversation
 *     is finished when its final message lands, and measuring from the start
 *     would delete a thread that is still being replied to.
 *   • `order` is the column that defines "oldest first" for batched deletes.
 *     `activity_logs` and `submissions` have AUTO_INCREMENT keys, so id order
 *     *is* time order and the primary key gives the cheapest contiguous range.
 *     `chat_sessions.id` is a UUID — ordering by it is lexicographic noise, so
 *     the row cap would evict an arbitrary set of conversations rather than the
 *     oldest ones. `reader_accounts` has an AUTO_INCREMENT key but still orders
 *     by `last_seen_at`, because id order is *signup* order: ordering by id would
 *     evict the portal's earliest-registered readers even when they commented
 *     this morning, which is the same mistake as ageing them by `created_at`.
 *     `livestream_sessions` orders by its age column too, for the same reason
 *     once more: an auto-increment id is insertion order and says nothing about
 *     when a broadcast ended, so ordering by id would evict a session started
 *     early and run for months before one started yesterday and stopped last
 *     night.
 *     Both non-id `order` columns below are indexed.
 *
 * `orderMayBeNull` marks the one table whose ordering column is NULL for a row
 * that must never be evicted: `livestream_sessions.ended_at` is NULL while a
 * broadcast is on air, and MySQL sorts NULL first ascending, so the row cap's
 * `ORDER BY ended_at LIMIT n` would delete the live broadcast before touching a
 * single finished one. The predicate is applied only where it is needed rather
 * than to every table: `WHERE id IS NOT NULL` is a no-op MySQL still has to
 * plan, and it would rewrite three statements that are currently provably
 * unchanged by this feature.
 *
 * `chat_messages` is deliberately absent. Its FK to `chat_sessions` is
 * ON DELETE CASCADE, so purging a conversation removes its transcript in the
 * same statement. Giving messages their own window would let a transcript be
 * deleted while its session row survives, leaving a record that claims N
 * messages and can show none — and a row cap on messages would truncate
 * conversations mid-thread. One window, on the conversation, cannot do either.
 *
 * `livestream_messages` is absent for the fourth time and the same reason: its
 * FK cascades from `livestream_sessions`. A message window would delete the chat
 * out of a broadcast that is still listed and still playable, and a message row
 * cap would cut a live conversation in half.
 *
 * `article_comments` is absent for exactly the same reason (design.md D16,
 * reader-google-login-comments). Its FKs cascade from BOTH `reader_accounts` and
 * `articles`, so it is already bounded by whichever parent goes first. An
 * independent age window would delete a reader's question while the portal's
 * official reply still displayed underneath as an answer to nothing, and a row
 * cap would cut a public exchange between a citizen and an officer in half — the
 * remaining half reading as something the whole never said.
 */
const TABLE_COLUMNS: Record<RetentionTarget, { timestamp: string; order: string; orderMayBeNull?: boolean }> = {
  activity_logs: { timestamp: 'created_at', order: 'id' },
  submissions: { timestamp: 'created_at', order: 'id' },
  chat_sessions: { timestamp: 'last_message_at', order: 'last_message_at' },
  reader_accounts: { timestamp: 'last_seen_at', order: 'last_seen_at' },
  // `ended_at` is both the age column and the ordering column, and it is NULL
  // for a session that is still live. `purgeOlderThan` already carries
  // `WHERE <timestamp> IS NOT NULL`, so a broadcast in progress is excluded from
  // the age pass by construction rather than by a branch that has to remember to
  // exclude it — and `orderMayBeNull` gives the row cap the same guarantee.
  livestream_sessions: { timestamp: 'ended_at', order: 'ended_at', orderMayBeNull: true },
}

export type DataRetentionOptions = {
  now?: Date
  activityLogDays?: number
  submissionDays?: number
  chatSessionDays?: number
  readerAccountDays?: number
  livestreamSessionDays?: number
  /** 0 = no cap. Rows beyond this are deleted oldest-first. */
  activityLogMaxRows?: number
  submissionMaxRows?: number
  chatSessionMaxRows?: number
  readerAccountMaxRows?: number
  livestreamSessionMaxRows?: number
  batchSize?: number
  maxBatches?: number
  connection?: Pool
  /**
   * When set, the run banks its counters in `data_retention_state`. Omitted by
   * callers that only want the deletion (and by tests), so bookkeeping never
   * becomes a hidden write.
   */
  trigger?: 'scheduler' | 'cron' | 'manual'
}

export type TableRetentionOutcome = {
  table: RetentionTarget
  /** 0 = retention disabled for this table; nothing was deleted. */
  retentionDays: number
  /** 0 = no row cap configured. */
  maxRows: number
  deleted: number
  deletedByAge: number
  deletedByRowCap: number
  /** true when maxBatches was exhausted — rows remain for the next run. */
  bounded: boolean
}

export type DataRetentionResult = {
  status: 'success' | 'warning' | 'failed'
  tables: TableRetentionOutcome[]
  /** Lapsed rate-limit buckets removed in the same pass. */
  purgedRateLimits: number
  message?: string
}

const DEFAULT_BATCH_SIZE = 1_000
const DEFAULT_MAX_BATCHES = 1_000

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

function cutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * `DELETE ... ORDER BY <order> LIMIT ?` repeatedly, so each statement works on a
 * contiguous indexed range instead of scattering across the table.
 */
async function purgeOlderThan(
  connection: PoolConnection,
  table: RetentionTarget,
  before: Date,
  batchSize: number,
  maxBatches: number,
): Promise<{ deleted: number; bounded: boolean }> {
  // `table` is a union of literals and the column names come from TABLE_COLUMNS,
  // never from caller input — no interpolation risk.
  const { timestamp, order } = TABLE_COLUMNS[table]
  const statement = `DELETE FROM ${table} WHERE ${timestamp} IS NOT NULL AND ${timestamp} < ? ORDER BY ${order} LIMIT ?`
  let deleted = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const [result] = await connection.query(statement, [before, batchSize])
    const affected = affectedRowsOrZero(result)
    deleted += affected
    if (affected < batchSize) return { deleted, bounded: false }
  }
  return { deleted, bounded: true }
}

/**
 * Trim the table down to `maxRows`, oldest first.
 *
 * The excess is measured once, up front, and only that many rows are deleted.
 * Re-counting between batches would let rows arriving during the run extend the
 * deletion into records that were inside the cap when the run started.
 *
 * Both the count and the delete carry `WHERE <order> IS NOT NULL` when the
 * ordering column can be NULL — that is `livestream_sessions` alone, whose
 * `ended_at` is NULL while a broadcast is live. MySQL sorts NULL first
 * ascending, so without the predicate `ORDER BY ended_at LIMIT n` would evict
 * the broadcast that is on air right now, before touching a single finished one.
 * Counting those rows as excess would be wrong too: it would report `remaining`
 * rows to delete and then delete fewer, leaving the run claiming a cap it never
 * applied. Tables whose order column is NOT NULL skip the predicate, so their
 * statements stay byte-for-byte what they were.
 */
async function purgeBeyondRowCap(
  connection: PoolConnection,
  table: RetentionTarget,
  maxRows: number,
  batchSize: number,
  maxBatches: number,
): Promise<{ deleted: number; bounded: boolean }> {
  const { order, orderMayBeNull } = TABLE_COLUMNS[table]
  const guard = orderMayBeNull ? ` WHERE ${order} IS NOT NULL` : ''
  const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM ${table}${guard}`)
  const total = Number((countRows as Array<{ total?: number }>)[0]?.total || 0)
  let remaining = total - maxRows
  if (remaining <= 0) return { deleted: 0, bounded: false }

  const statement = `DELETE FROM ${table}${guard} ORDER BY ${order} LIMIT ?`
  let deleted = 0
  for (let batch = 0; batch < maxBatches && remaining > 0; batch += 1) {
    const limit = Math.min(batchSize, remaining)
    const [result] = await connection.query(statement, [limit])
    const affected = affectedRowsOrZero(result)
    deleted += affected
    remaining -= affected
    if (affected < limit) return { deleted, bounded: false }
  }
  return { deleted, bounded: remaining > 0 }
}

/**
 * Bank the run's counters. `purged_total` is incremented rather than replaced:
 * once the rows are gone, a purge that worked looks exactly like one that never
 * ran, and "how much have we ever deleted" is the number an operator needs to
 * add to the live count to see lifetime volume.
 */
async function recordScopeState(
  connection: PoolConnection,
  outcome: TableRetentionOutcome,
  trigger: string,
  status: string,
  message: string | null,
  now: Date,
): Promise<void> {
  await connection.query(
    `INSERT INTO data_retention_state
       (scope, purged_total, last_run_at, last_deleted, last_trigger, last_status, last_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       purged_total = purged_total + VALUES(purged_total),
       last_run_at = VALUES(last_run_at),
       last_deleted = VALUES(last_deleted),
       last_trigger = VALUES(last_trigger),
       last_status = VALUES(last_status),
       last_message = VALUES(last_message)`,
    [outcome.table, outcome.deleted, now, outcome.deleted, trigger, status, message?.slice(0, 512) ?? null],
  )
}

export async function runDataRetention(options: DataRetentionOptions = {}): Promise<DataRetentionResult> {
  const configured = resolveDataRetentionConfig()
  const now = options.now ?? new Date()
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 50_000)
  const maxBatches = boundedInteger(options.maxBatches, DEFAULT_MAX_BATCHES, 1, 100_000)

  const windows: Array<{ table: RetentionTarget; days: number; maxRows: number }> = [
    {
      table: 'activity_logs',
      days: boundedInteger(options.activityLogDays, configured.activityLogDays, 0, 3650),
      maxRows: boundedInteger(options.activityLogMaxRows, 0, 0, 100_000_000),
    },
    {
      table: 'submissions',
      days: boundedInteger(options.submissionDays, configured.submissionDays, 0, 3650),
      maxRows: boundedInteger(options.submissionMaxRows, 0, 0, 100_000_000),
    },
    {
      table: 'chat_sessions',
      days: boundedInteger(options.chatSessionDays, configured.chatSessionDays, 0, 3650),
      maxRows: boundedInteger(options.chatSessionMaxRows, 0, 0, 100_000_000),
    },
    {
      table: 'reader_accounts',
      days: boundedInteger(options.readerAccountDays, configured.readerAccountDays, 0, 3650),
      maxRows: boundedInteger(options.readerAccountMaxRows, 0, 0, 100_000_000),
    },
    {
      table: 'livestream_sessions',
      days: boundedInteger(options.livestreamSessionDays, configured.livestreamSessionDays, 0, 3650),
      maxRows: boundedInteger(options.livestreamSessionMaxRows, 0, 0, 100_000_000),
    },
  ]

  const pool = options.connection ?? createAnalyticsPool()
  const ownsPool = !options.connection
  const tables: TableRetentionOutcome[] = []
  let purgedRateLimits = 0

  let connection: PoolConnection | null = null
  try {
    connection = await pool.getConnection()
    for (const { table, days, maxRows } of windows) {
      let deletedByAge = 0
      let deletedByRowCap = 0
      let bounded = false

      if (days > 0) {
        const aged = await purgeOlderThan(connection, table, cutoff(now, days), batchSize, maxBatches)
        deletedByAge = aged.deleted
        bounded = aged.bounded
      }
      // Skipped when the age pass already hit its ceiling: the table is still
      // shrinking, and counting rows mid-catch-up would delete more than the cap.
      if (maxRows > 0 && !bounded) {
        const capped = await purgeBeyondRowCap(connection, table, maxRows, batchSize, maxBatches)
        deletedByRowCap = capped.deleted
        bounded = capped.bounded
      }

      tables.push({
        table,
        retentionDays: days,
        maxRows,
        deleted: deletedByAge + deletedByRowCap,
        deletedByAge,
        deletedByRowCap,
        bounded,
      })
    }
    // Lapsed lockout counters serve no purpose and would otherwise accumulate
    // one row per source IP for the life of the deployment.
    purgedRateLimits = await purgeExpiredRateLimits({
      now: () => now.getTime(),
      execute: (sql, params) => connection!.query(sql, params),
    })

    if (options.trigger) {
      const bounded = tables.some(entry => entry.bounded)
      const status = bounded ? 'warning' : 'success'
      const message = bounded ? 'Đã đạt giới hạn số lô; lượt chạy sau tiếp tục.' : null
      for (const outcome of tables) {
        await recordScopeState(connection, outcome, options.trigger, status, message, now)
      }
    }
  } catch (error) {
    return {
      status: 'failed',
      tables,
      purgedRateLimits,
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    connection?.release()
    if (ownsPool) await pool.end().catch(() => {})
  }

  const bounded = tables.some(entry => entry.bounded)
  return {
    status: bounded ? 'warning' : 'success',
    tables,
    purgedRateLimits,
    message: bounded ? 'Batch limit reached; rows remain. The next run continues.' : undefined,
  }
}
