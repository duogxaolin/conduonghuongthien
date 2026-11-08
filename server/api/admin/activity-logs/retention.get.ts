/**
 * Retention status for `activity_logs` — how many rows are held, how old the
 * oldest one is, how many are past the configured window, and how many have
 * ever been deleted.
 *
 * The lifetime figure is the reason `data_retention_state` exists. Once rows are
 * purged, a purge that worked is indistinguishable from one that never ran, so
 * the count is banked before deletion: lifetime = purgedTotal + live rows.
 *
 * `overdue > 0` is the observable symptom of a purge that is not happening —
 * rows older than the window are still present, so the scheduler is off, the
 * cron is missing, or a run is failing.
 *
 * Read-only. It reports; it never purges. A purge triggered from a page load
 * would delete audit rows on a stray refresh.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { resolveRetentionPolicy } from '../../../services/retention-policy'
import { loadRetentionState } from '../../../services/retention-state'
import { readActivityLogRetentionCounts } from '../../../services/admin-activity-logs-retention'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'users', 'read')

  const policy = await resolveRetentionPolicy()
  const scope = policy.scopes.find(entry => entry.scope === 'activity_logs')
  const retentionDays = scope?.days ?? 0
  const maxRows = scope?.maxRows ?? 0

  // One aggregate SELECT (services/admin-activity-logs-retention.ts) — read-only, like this route.
  const row = await readActivityLogRetentionCounts(retentionDays)

  const total = Number(row?.total ?? 0)
  const overdue = Number(row?.overdue ?? 0)

  const state = (await loadRetentionState()).find(entry => entry.scope === 'activity_logs')
  const purgedTotal = state?.purgedTotal ?? 0

  // Both conditions disabled = nothing will ever be deleted, regardless of the
  // scheduler. Reported plainly rather than as "no overdue rows, all good".
  const purgeDisabled = retentionDays === 0 && maxRows === 0

  return {
    ok: true,
    total,
    overdue,
    oldest: row?.oldest ?? null,
    newest: row?.newest ?? null,
    retentionDays,
    maxRows,
    /** Rows deleted by every past run, banked so the evidence outlives the rows. */
    purgedTotal,
    /** Live + deleted: how much this table has held over its lifetime. */
    lifetimeTotal: total + purgedTotal,
    overRowCap: maxRows > 0 ? Math.max(0, total - maxRows) : 0,
    lastRunAt: state?.lastRunAt ?? null,
    lastDeleted: state?.lastDeleted ?? 0,
    lastTrigger: state?.lastTrigger ?? null,
    lastStatus: state?.lastStatus ?? null,
    autoEnabled: policy.autoEnabled,
    runHour: policy.runHour,
    /** true = neither the age window nor the row cap will delete anything. */
    purgeDisabled,
    /** true = rows past the window are still here, so the purge is not running. */
    purgeOverdue: retentionDays > 0 && overdue > 0,
    command: 'npm run analytics:maintenance',
  }
})
