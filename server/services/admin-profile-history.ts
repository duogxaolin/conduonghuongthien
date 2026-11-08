/**
 * The login and action history of an administrator (`GET /api/admin/profile/history`) — its reads
 * and its read-audit row, moved out of the handler verbatim (2026-11-08: no `server/api` file calls
 * getDb() itself). The handler keeps who may read whose history (own rows for anyone signed in;
 * another account's rows only for a SuperAdmin), parsing and rejecting the query (page, page size,
 * Vietnam calendar days), the 404 for an unknown account, the admin's IP and the response shape.
 *
 * A cross-user read is itself recorded — a history view that can be read silently is a
 * surveillance tool rather than an audit trail. One row per request, on the pool after the reads:
 * there is no row write to pair it with, and this file writes nothing else
 * (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in `tests/reader-audit-atomicity.test.ts` checks that premise
 * on every run). A failed insert fails the request, as before.
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, users } from '../db/schema'

/** One page of `targetId`'s activity rows (newest first) and the total under the same range. */
export async function listActivityHistoryPage(filters: {
  targetId: number
  from: Date | null
  toExclusive: Date | null
  page: number
  pageSize: number
}) {
  const { targetId, from, toExclusive, page, pageSize } = filters
  const db = getDb()
  const conditions = [eq(activityLogs.userId, targetId)]
  if (from) conditions.push(gte(activityLogs.createdAt, from))
  if (toExclusive) conditions.push(lt(activityLogs.createdAt, toExclusive))
  const where = and(...conditions)

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(activityLogs)
    .where(where)
  const total = Number(countRow?.total ?? 0)

  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      resource: activityLogs.resource,
      resourceId: activityLogs.resourceId,
      meta: activityLogs.meta,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .where(where)
    // Tie-broken by id so pagination is stable when rows share a timestamp.
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return { total, rows }
}

/** The username of the account whose history a SuperAdmin asked for — or undefined (404 at the handler). */
export async function findHistoryTarget(targetId: number) {
  const db = getDb()
  const [target] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)
  return target
}

/** The cross-user read is itself an auditable event. */
export async function auditUserHistoryRead(adminId: number, targetId: number, meta: { targetUsername: string, ip: string }) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: adminId,
    action: 'read',
    resource: 'user_history',
    resourceId: targetId,
    meta,
  })
}
