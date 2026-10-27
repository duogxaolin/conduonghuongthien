/**
 * Run the retention purge now.
 *
 * This one deletes rows, so three things guard it:
 *   • POST only — a purge must never be reachable by following a link or by a
 *     browser prefetching a URL.
 *   • `confirm: true` in the body — an explicit act, not a stray click.
 *   • the same MySQL named lock the scheduler uses, so a double-click or a
 *     concurrent cron run cannot purge twice in parallel.
 *
 * `force` skips the "is it due yet" check but nothing else: the configured
 * windows still decide what is deleted. There is no way to purge more than the
 * policy allows from here, which is why the operator does not get to pass a
 * window as a parameter.
 *
 * Audit: a manual run is ALWAYS attributed. The purge deletes in batches on its
 * own pool and cannot share a transaction with an audit row, so the row that
 * names the officer is written first — under the lock, before the first DELETE
 * (`beforePurge`) — and the pass does not start without it. The result (what
 * each table lost) is a second row after the pass. Until FINDING-R3-2 there was
 * only that second row: if its insert failed the officer saw a 500 for a purge
 * that had deleted rows, and nothing recorded who started it.
 *
 * Same start + finish shape as `ai/moderation/rescan-all.post.ts`, with one
 * deliberate difference: there the start row is best-effort, here it is
 * fail-closed, because this job deletes data. The finish row stays best-effort —
 * the purge has committed by then, so its failure is logged and reported as
 * `auditFailed`, never as a 500 that would read "nothing happened".
 */
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { runRetentionPass } from '../../../services/retention-scheduler'
import { logError } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  if (body?.confirm !== true) {
    throw createError({ statusCode: 400, statusMessage: 'Cần xác nhận trước khi chạy dọn dữ liệu.' })
  }

  const db = getDb()
  const outcome = await runRetentionPass({
    force: true,
    trigger: 'manual',
    beforePurge: async ({ scopes }) => {
      try {
        await db.insert(activityLogs).values({
          userId: admin.id,
          action: 'delete',
          resource: 'data_retention',
          meta: { trigger: 'manual', phase: 'started', scopes },
        })
      } catch (error) {
        logError({ event: 'retention.manual_start_audit_failed', actorId: admin.id, error: error instanceof Error ? error.message : String(error) })
        throw createError({ statusCode: 500, statusMessage: 'Không ghi được nhật ký kiểm toán nên chưa chạy dọn dữ liệu — chưa có bản ghi nào bị xoá.' })
      }
    },
  })

  if (!outcome.ran) {
    // 'locked' is the only reason a forced pass declines: another run holds the
    // lock. Reported as a conflict so the UI can say "đang chạy" instead of
    // claiming success with zero deletions.
    throw createError({ statusCode: 409, statusMessage: 'Một lượt dọn khác đang chạy. Thử lại sau ít phút.' })
  }

  let auditFailed = false
  try {
    await db.insert(activityLogs).values({
      userId: admin.id,
      action: 'delete',
      resource: 'data_retention',
      meta: {
        trigger: 'manual',
        phase: 'finished',
        status: outcome.result.status,
        tables: outcome.result.tables.map(entry => ({
          table: entry.table,
          deleted: entry.deleted,
          byAge: entry.deletedByAge,
          byRowCap: entry.deletedByRowCap,
        })),
      },
    })
  } catch (error) {
    // The run is already on record (the `started` row) and its counts are banked
    // in `data_retention_state`; what is lost is the per-table summary row.
    auditFailed = true
    logError({
      event: 'retention.manual_result_audit_failed',
      actorId: admin.id,
      status: outcome.result.status,
      deleted: outcome.result.tables.reduce((sum, entry) => sum + entry.deleted, 0),
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { ok: true, status: outcome.result.status, tables: outcome.result.tables, message: outcome.result.message, auditFailed }
})
