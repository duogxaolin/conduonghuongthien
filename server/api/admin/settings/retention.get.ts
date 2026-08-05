/**
 * The retention policy as it will actually be applied, plus the bookkeeping for
 * both purged tables and their current sizes.
 *
 * Each value reports its source (`database` | `environment` | `default`) so an
 * operator can see that a `.env` line is being overridden by the form — without
 * that, editing the file and seeing nothing change is a silent dead end.
 *
 * Gated on `settings:read`: this is configuration, not the audit log, so it
 * follows the same boundary as the other settings pages.
 */
import { sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { activityLogs, submissions, chatSessions, readerAccounts } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import {
  resolveRetentionPolicy,
  loadRetentionState,
  RETENTION_DEFAULTS,
  MAX_ROWS_BOUNDS,
} from '../../../services/retention-policy'
import { DATA_RETENTION_BOUNDS } from '../../../utils/data-retention-config'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'read')

  const policy = await resolveRetentionPolicy()
  const state = await loadRetentionState()
  const db = getDb()

  /**
   * The column each scope is aged against. This MUST be the same column
   * `data-retention.ts` deletes on: if this endpoint counted `started_at` while
   * the purge measured `last_message_at`, the page would report a number of
   * overdue rows that the next run does not delete, and the discrepancy would
   * read as a broken purge rather than as two different questions.
   */
  const scopeTable = {
    activity_logs: { target: activityLogs, timestamp: activityLogs.createdAt },
    submissions: { target: submissions, timestamp: submissions.createdAt },
    chat_sessions: { target: chatSessions, timestamp: chatSessions.lastMessageAt },
    reader_accounts: { target: readerAccounts, timestamp: readerAccounts.lastSeenAt },
  } as const

  const scopes = await Promise.all(policy.scopes.map(async (scope) => {
    const { target, timestamp } = scopeTable[scope.scope]
    const [row] = await db
      .select({
        total: sql<number>`COUNT(*)`,
        oldest: sql<string | null>`MIN(${timestamp})`,
        overdue: scope.days > 0
          ? sql<number>`SUM(CASE WHEN ${timestamp} < (NOW() - INTERVAL ${sql.raw(String(scope.days))} DAY) THEN 1 ELSE 0 END)`
          : sql<number>`0`,
      })
      .from(target)

    const total = Number(row?.total ?? 0)
    const banked = state.find(entry => entry.scope === scope.scope)
    const purgedTotal = banked?.purgedTotal ?? 0

    return {
      ...scope,
      total,
      oldest: row?.oldest ?? null,
      overdue: Number(row?.overdue ?? 0),
      overRowCap: scope.maxRows > 0 ? Math.max(0, total - scope.maxRows) : 0,
      purgedTotal,
      lifetimeTotal: total + purgedTotal,
      lastRunAt: banked?.lastRunAt ?? null,
      lastDeleted: banked?.lastDeleted ?? 0,
      lastTrigger: banked?.lastTrigger ?? null,
      lastStatus: banked?.lastStatus ?? null,
      lastMessage: banked?.lastMessage ?? null,
    }
  }))

  return {
    ok: true,
    autoEnabled: policy.autoEnabled,
    autoEnabledSource: policy.autoEnabledSource,
    runHour: policy.runHour,
    runHourSource: policy.runHourSource,
    scopes,
    bounds: {
      days: DATA_RETENTION_BOUNDS,
      maxRows: MAX_ROWS_BOUNDS,
    },
    defaults: RETENTION_DEFAULTS,
    command: 'npm run analytics:maintenance',
  }
})
