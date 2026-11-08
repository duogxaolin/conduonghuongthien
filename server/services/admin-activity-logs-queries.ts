/**
 * The system-wide activity log for administrators (`GET /api/admin/activity-logs`) — its two
 * reads and its read-audit row, moved out of the handler verbatim (2026-11-08: no `server/api`
 * file calls getDb() itself). The handler keeps the `users.read` gate, parsing and rejecting the
 * filters (Vietnam calendar days, bounded strings, paging), the admin's IP and the shape of the
 * response (`readMeta` surfaces only allowlisted meta keys).
 *
 * The read is recorded: reading EVERY account's trail exposes who was active, from which IP, at
 * what hour. One audit row per request, written on the pool after the reads — there is no row
 * write to pair it with. This file writes nothing else (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in
 * `tests/reader-audit-atomicity.test.ts` checks that premise on every run).
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, users } from '../db/schema'

/** One page of log rows (newest first) and the total under the same filters. */
export async function listActivityLogsPage(filters: {
  userId: number | null
  action: string | null
  resource: string | null
  /** 00:00 +07:00 of the first Vietnam day, or null. */
  from: Date | null
  /** 00:00 +07:00 of the day AFTER the last one, or null. */
  toExclusive: Date | null
  page: number
  pageSize: number
}) {
  const { userId, action, resource, from, toExclusive, page, pageSize } = filters
  const db = getDb()
  const conditions = []
  if (userId !== null) conditions.push(eq(activityLogs.userId, userId))
  if (action) conditions.push(eq(activityLogs.action, action))
  if (resource) conditions.push(eq(activityLogs.resource, resource))
  if (from) conditions.push(gte(activityLogs.createdAt, from))
  if (toExclusive) conditions.push(lt(activityLogs.createdAt, toExclusive))
  const where = conditions.length ? and(...conditions) : undefined

  const [countRow] = await db.select({ total: sql<number>`COUNT(*)` }).from(activityLogs).where(where)
  const total = Number(countRow?.total ?? 0)

  const rows = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      username: users.username,
      action: activityLogs.action,
      resource: activityLogs.resource,
      resourceId: activityLogs.resourceId,
      meta: activityLogs.meta,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    // Left join: rows survive the account being deleted, and an orphaned trail
    // is exactly what an audit needs to keep.
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(where)
    // Tie-broken by id so pagination is stable when rows share a timestamp.
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return { total, rows }
}

/** The audit row of one read of the log: who, which filters, from which IP. A failed insert fails the request. */
export async function auditActivityLogRead(adminId: number, resourceId: number | null, meta: {
  filters: { userId: number | null, action: string | null, resource: string | null, from: unknown, to: unknown }
  ip: string
}) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: adminId,
    action: 'read',
    resource: 'activity_logs',
    resourceId,
    meta,
  })
}
