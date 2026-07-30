/**
 * Retention status for `activity_logs` — how many rows are held, how old the
 * oldest one is, and how many are already past the configured window.
 *
 * This exists because the purge is NOT self-starting. `runDataRetention()` only
 * runs when `npm run analytics:maintenance` is invoked, which needs an external
 * cron line. Without it the table grows forever and nothing in the product says
 * so. `overdue > 0` is the observable symptom: rows older than the window are
 * still present, so the cron is missing, disabled, or failing.
 *
 * Read-only. It reports; it never purges. A purge triggered from a page load
 * would delete audit rows on a stray refresh.
 */
import { sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { resolveDataRetentionConfig } from '../../../utils/data-retention-config'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'users', 'read')

  const { activityLogDays } = resolveDataRetentionConfig()
  const db = getDb()

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      oldest: sql<string | null>`MIN(${activityLogs.createdAt})`,
      newest: sql<string | null>`MAX(${activityLogs.createdAt})`,
      // 0 days means the purge is disabled, so nothing can be overdue.
      overdue: activityLogDays > 0
        ? sql<number>`SUM(CASE WHEN ${activityLogs.createdAt} < (NOW() - INTERVAL ${sql.raw(String(activityLogDays))} DAY) THEN 1 ELSE 0 END)`
        : sql<number>`0`,
    })
    .from(activityLogs)

  const total = Number(row?.total ?? 0)
  const overdue = Number(row?.overdue ?? 0)

  return {
    ok: true,
    total,
    overdue,
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
    retentionDays: activityLogDays,
    /** true = purge disabled by configuration (ACTIVITY_LOG_RETENTION_DAYS=0). */
    purgeDisabled: activityLogDays === 0,
    /** true = rows past the window are still here, so the cron is not working. */
    purgeOverdue: activityLogDays > 0 && overdue > 0,
    command: 'npm run analytics:maintenance',
  }
})
