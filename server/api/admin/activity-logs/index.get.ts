/**
 * System-wide activity log for administrators.
 *
 * This is the cross-account view that `profile/history.get.ts` deliberately does
 * not offer: that route answers "what did ONE account do", identified from the
 * session, and it exists so every administrator can audit themselves without
 * holding any RBAC resource. Reading EVERY account's trail is a different
 * capability — it exposes who was active, from which IP, at what hour — so it is
 * gated on the `users` resource, the same grant that already lets an operator
 * see the account list. SuperAdmin passes through `checkPermission` as usual.
 *
 * The read is itself recorded, for the same reason the cross-user read in
 * `profile/history.get.ts` is: an audit trail that can be swept silently is a
 * surveillance tool. One row per request, not per log line displayed.
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { activityLogs, users } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { getClientIp } from '../../../utils/client-ip'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Rejects rather than clamping: silently substituting a different range would
 *  make the response a lie about which period was audited. */
function parseDate(raw: string | undefined, label: string): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw createError({ statusCode: 400, statusMessage: `Giá trị ${label} không phải là ngày hợp lệ.` })
  }
  return parsed
}

/** Bounded so the filter cannot be turned into a probe for arbitrary columns. */
function parseFilter(raw: unknown, label: string, max: number): string | null {
  if (raw === undefined || raw === null || String(raw) === '') return null
  const value = String(raw).trim()
  if (!value) return null
  if (value.length > max) {
    throw createError({ statusCode: 400, statusMessage: `Giá trị ${label} vượt quá ${max} ký tự.` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'users', 'read')

  const query = getQuery(event)

  let userId: number | null = null
  if (query.userId !== undefined && String(query.userId) !== '') {
    const requested = Number(query.userId)
    if (!Number.isInteger(requested) || requested <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'userId không hợp lệ.' })
    }
    userId = requested
  }

  const action = parseFilter(query.action, 'action', 32)
  const resource = parseFilter(query.resource, 'resource', 64)

  const page = Number(query.page ?? 1)
  const pageSize = Number(query.pageSize ?? DEFAULT_PAGE_SIZE)
  if (!Number.isInteger(page) || page < 1) {
    throw createError({ statusCode: 400, statusMessage: 'page phải là số nguyên từ 1 trở lên.' })
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw createError({ statusCode: 400, statusMessage: `pageSize phải là số nguyên từ 1 đến ${MAX_PAGE_SIZE}.` })
  }

  const from = parseDate(query.from as string | undefined, 'from')
  const to = parseDate(query.to as string | undefined, 'to')
  if (from && to && from.getTime() > to.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Khoảng thời gian không hợp lệ: from phải trước to.' })
  }

  const db = getDb()
  const conditions = []
  if (userId !== null) conditions.push(eq(activityLogs.userId, userId))
  if (action) conditions.push(eq(activityLogs.action, action))
  if (resource) conditions.push(eq(activityLogs.resource, resource))
  if (from) conditions.push(gte(activityLogs.createdAt, from))
  if (to) conditions.push(lte(activityLogs.createdAt, to))
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

  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'read',
    resource: 'activity_logs',
    resourceId: userId,
    meta: {
      filters: { userId, action, resource, from: query.from ?? null, to: query.to ?? null },
      ip: getClientIp(event),
    },
  })

  return {
    ok: true,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map(row => ({
      id: row.id,
      userId: row.userId,
      username: row.username,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      createdAt: row.createdAt,
      ip: readMeta(row.meta, 'ip'),
      userAgent: readMeta(row.meta, 'userAgent'),
      mfaMethod: readMeta(row.meta, 'mfaMethod'),
    })),
  }
})

/** activity_logs.meta is free-form JSON; only these three keys are surfaced. */
function readMeta(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== 'object') return null
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : null
}
