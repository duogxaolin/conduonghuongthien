/**
 * Retention status of `activity_logs` (`GET /api/admin/activity-logs/retention`) — its one
 * aggregate read, moved out of the handler verbatim (2026-11-08: no `server/api` file calls
 * getDb() itself). The handler keeps the `users.read` gate, the effective policy
 * (`resolveRetentionPolicy`), the banked counters (`loadRetentionState`) and the shape of the
 * report.
 *
 * Read-only. It reports; it never purges. A purge triggered from a page load would delete audit
 * rows on a stray refresh.
 */
import { intervalDays } from '../utils/sql-literals'
import { sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** Rows held, oldest/newest, and how many are older than `retentionDays` (0 = age condition off). */
export async function readActivityLogRetentionCounts(retentionDays: number) {
  const db = getDb()

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      oldest: sql<string | null>`MIN(${activityLogs.createdAt})`,
      newest: sql<string | null>`MAX(${activityLogs.createdAt})`,
      // 0 days means the age condition is disabled, so nothing can be overdue.
      overdue: retentionDays > 0
        ? sql<number>`SUM(CASE WHEN ${activityLogs.createdAt} < (NOW() - INTERVAL ${intervalDays(retentionDays)} DAY) THEN 1 ELSE 0 END)`
        : sql<number>`0`,
    })
    .from(activityLogs)

  return row
}
