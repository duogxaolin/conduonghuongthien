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
 */
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { runRetentionPass } from '../../../services/retention-scheduler'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  if (body?.confirm !== true) {
    throw createError({ statusCode: 400, statusMessage: 'Cần xác nhận trước khi chạy dọn dữ liệu.' })
  }

  const outcome = await runRetentionPass({ force: true, trigger: 'manual' })

  if (!outcome.ran) {
    // 'locked' is the only reason a forced pass declines: another run holds the
    // lock. Reported as a conflict so the UI can say "đang chạy" instead of
    // claiming success with zero deletions.
    throw createError({ statusCode: 409, statusMessage: 'Một lượt dọn khác đang chạy. Thử lại sau ít phút.' })
  }

  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'delete',
    resource: 'data_retention',
    meta: {
      trigger: 'manual',
      status: outcome.result.status,
      tables: outcome.result.tables.map(entry => ({
        table: entry.table,
        deleted: entry.deleted,
        byAge: entry.deletedByAge,
        byRowCap: entry.deletedByRowCap,
      })),
      purgedRateLimits: outcome.result.purgedRateLimits,
    },
  })

  return { ok: true, status: outcome.result.status, tables: outcome.result.tables, message: outcome.result.message }
})
