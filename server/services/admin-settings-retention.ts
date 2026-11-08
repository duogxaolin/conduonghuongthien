/**
 * The data-retention settings page (`GET /api/admin/settings/retention`, `POST
 * …/retention-run`) — their queries, moved out of the handlers verbatim.
 *
 *  - The size/age count of one purged table. Which column each scope is aged against stays in
 *    `retention.get.ts` (its `scopeTable`, keyed by `RetentionScope` so a new scope fails to
 *    compile until named there); this file only counts the table it is handed.
 *  - The two audit rows of a manual run. Each is the only write of its moment — the purge
 *    deletes in batches on its own pool and cannot share a transaction with them — so they are
 *    written on the pool, as before. The handler keeps the try/catch around each: the start row
 *    is fail-closed (no row, no purge), the result row best-effort (`auditFailed`).
 */
import { intervalDays } from '../utils/sql-literals'
import { sql } from 'drizzle-orm'
import type { AnyMySqlColumn, AnyMySqlTable } from 'drizzle-orm/mysql-core'
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'
import type { DataRetentionResult } from './data-retention'

/** Rows of `target`, its oldest `timestamp`, and how many are older than `days` (0 = window off). */
export async function countRetentionScopeRows(target: AnyMySqlTable, timestamp: AnyMySqlColumn, days: number) {
  const db = getDb()
  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      oldest: sql<string | null>`MIN(${timestamp})`,
      overdue: days > 0
        ? sql<number>`SUM(CASE WHEN ${timestamp} < (NOW() - INTERVAL ${intervalDays(days)} DAY) THEN 1 ELSE 0 END)`
        : sql<number>`0`,
    })
    .from(target)
  return row
}

/** The audit row naming the officer, written under the lock before the first DELETE. */
export async function writeRetentionRunStartAudit(actorId: number, scopes: Array<{ scope: string, days: number, maxRows: number }>) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: actorId,
    action: 'delete',
    resource: 'data_retention',
    meta: { trigger: 'manual', phase: 'started', scopes },
  })
}

/** The audit row with what each table lost, after the pass. */
export async function writeRetentionRunResultAudit(actorId: number, result: DataRetentionResult) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: actorId,
    action: 'delete',
    resource: 'data_retention',
    meta: {
      trigger: 'manual',
      phase: 'finished',
      status: result.status,
      tables: result.tables.map(entry => ({
        table: entry.table,
        deleted: entry.deleted,
        byAge: entry.deletedByAge,
        byRowCap: entry.deletedByRowCap,
      })),
    },
  })
}
