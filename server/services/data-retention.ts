import type { Pool, PoolConnection } from 'mysql2/promise'
import { createAnalyticsPool } from './analytics-maintenance'
import { resolveDataRetentionConfig } from '../utils/data-retention-config'

/**
 * Purge the operational tables that hold personal data past their retention
 * window. Analytics maintenance already prunes its own nine tables; these two
 * were never covered.
 *
 * Deletion is batched with a LIMIT and bounded by `maxBatches`, so a first run
 * against years of accumulated rows cannot hold a long lock or fill the binlog
 * in one statement. When the bound is hit the run reports `bounded: true` and
 * the next run continues where this one stopped.
 */

export type RetentionTarget = 'activity_logs' | 'submissions'

export type DataRetentionOptions = {
  now?: Date
  activityLogDays?: number
  submissionDays?: number
  batchSize?: number
  maxBatches?: number
  connection?: Pool
}

export type TableRetentionOutcome = {
  table: RetentionTarget
  /** 0 = retention disabled for this table; nothing was deleted. */
  retentionDays: number
  deleted: number
  /** true when maxBatches was exhausted — rows remain for the next run. */
  bounded: boolean
}

export type DataRetentionResult = {
  status: 'success' | 'warning' | 'failed'
  tables: TableRetentionOutcome[]
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
 * `DELETE ... ORDER BY id LIMIT ?` repeatedly. Ordering by the primary key
 * keeps each statement working on a contiguous range instead of scattering
 * across the table.
 */
async function purgeOlderThan(
  connection: PoolConnection,
  table: RetentionTarget,
  before: Date,
  batchSize: number,
  maxBatches: number,
): Promise<{ deleted: number; bounded: boolean }> {
  // `table` is a union of two literals, never caller input — no interpolation risk.
  const statement = `DELETE FROM ${table} WHERE created_at IS NOT NULL AND created_at < ? ORDER BY id LIMIT ?`
  let deleted = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const [result] = await connection.query(statement, [before, batchSize])
    const affected = Number((result as { affectedRows?: number }).affectedRows || 0)
    deleted += affected
    if (affected < batchSize) return { deleted, bounded: false }
  }
  return { deleted, bounded: true }
}

export async function runDataRetention(options: DataRetentionOptions = {}): Promise<DataRetentionResult> {
  const configured = resolveDataRetentionConfig()
  const now = options.now ?? new Date()
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 50_000)
  const maxBatches = boundedInteger(options.maxBatches, DEFAULT_MAX_BATCHES, 1, 100_000)

  const windows: Array<{ table: RetentionTarget; days: number }> = [
    { table: 'activity_logs', days: boundedInteger(options.activityLogDays, configured.activityLogDays, 0, 3650) },
    { table: 'submissions', days: boundedInteger(options.submissionDays, configured.submissionDays, 0, 3650) },
  ]

  const pool = options.connection ?? createAnalyticsPool()
  const ownsPool = !options.connection
  const tables: TableRetentionOutcome[] = []

  let connection: PoolConnection | null = null
  try {
    connection = await pool.getConnection()
    for (const { table, days } of windows) {
      if (days === 0) {
        tables.push({ table, retentionDays: 0, deleted: 0, bounded: false })
        continue
      }
      const { deleted, bounded } = await purgeOlderThan(connection, table, cutoff(now, days), batchSize, maxBatches)
      tables.push({ table, retentionDays: days, deleted, bounded })
    }
  } catch (error) {
    return {
      status: 'failed',
      tables,
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
    message: bounded ? 'Batch limit reached; rows remain. The next run continues.' : undefined,
  }
}
