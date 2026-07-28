/**
 * Login and action history from activity_logs.
 *
 * Any authenticated administrator reads their own rows with no RBAC resource
 * required. Reading another account's rows requires SuperAdmin, and that access
 * is itself recorded — a history view that can be read silently is a surveillance
 * tool rather than an audit trail.
 */
import { getRequestIP } from 'h3'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { activityLogs, users } from '../../../db/schema'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/** Rejects rather than clamping: a malformed range is a caller bug, and silently
 *  substituting a different range makes the response a lie. */
function parseDate(raw: string | undefined, label: string): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    throw createError({ statusCode: 400, statusMessage: `Giá trị ${label} không phải là ngày hợp lệ.` })
  }
  return parsed
}

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const query = getQuery(event)

  // Absent userId means "my own history"; an explicit one is a cross-user read.
  const requestedRaw = query.userId
  let targetId = admin.id
  let crossUser = false
  if (requestedRaw !== undefined && String(requestedRaw) !== '') {
    const requested = Number(requestedRaw)
    if (!Number.isInteger(requested) || requested <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'userId không hợp lệ.' })
    }
    if (requested !== admin.id) {
      if (admin.isSuperAdmin !== true) {
        throw createError({ statusCode: 403, statusMessage: 'Bạn không có quyền xem lịch sử của tài khoản khác.' })
      }
      targetId = requested
      crossUser = true
    }
  }

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
  const conditions = [eq(activityLogs.userId, targetId)]
  if (from) conditions.push(gte(activityLogs.createdAt, from))
  if (to) conditions.push(lte(activityLogs.createdAt, to))
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

  let targetUsername: string | null = null
  if (crossUser) {
    const [target] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Người dùng không tồn tại' })
    targetUsername = target.username

    // The cross-user read is itself an auditable event.
    await db.insert(activityLogs).values({
      userId: admin.id,
      action: 'read',
      resource: 'user_history',
      resourceId: targetId,
      meta: {
        targetUsername: target.username,
        ip: getRequestIP(event, { xForwardedFor: false }) || 'unknown',
      },
    })
  }

  return {
    ok: true,
    userId: targetId,
    targetUsername,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map(row => ({
      id: row.id,
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
