/**
 * Visitor chat sessions for administrators.
 *
 * Gated on `chatbot_knowledge.read` rather than a new resource: anyone trusted
 * to read the approved knowledge bank is already trusted with what visitors ask
 * of it, and inventing a resource would mean every existing role has to be
 * re-granted before the page works for anyone but SuperAdmin.
 *
 * The read is recorded. These rows carry IP addresses and, when a visitor typed
 * one, a phone number — a log that can be swept silently is a surveillance tool,
 * not an audit trail. One row per request, not per session displayed.
 */

import { and, desc, gte, isNotNull, lt, sql } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, chatSessions } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
import { summarizeUserAgent } from '../../../../utils/chatbot/user-agent'
import { DAY_MS, vietnamDayStart } from '../../../../utils/vn-day-range'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/**
 * `from`/`to` are the page's `<input type="date">` values — Vietnam calendar days,
 * `YYYY-MM-DD`. Returns 00:00 +07:00 of that day. Rejects rather than clamping:
 * quietly substituting a different range would make the response a lie about which
 * period was reviewed.
 *
 * Previously `new Date(raw)` read `to=2026-10-14` as 00:00 UTC of the 14th, so the
 * end day was excluded entirely and both bounds were 7 hours off the Vietnamese
 * day. See `server/utils/vn-day-range.ts`.
 */
function parseDay(raw: unknown, label: string): Date | null {
  if (raw === undefined || raw === null || raw === '') return null
  const start = vietnamDayStart(raw)
  if (!start) {
    throw createError({ statusCode: 400, statusMessage: `Giá trị ${label} không phải là ngày hợp lệ (YYYY-MM-DD).` })
  }
  return start
}

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'chatbot_knowledge', 'read')

  const query = getQuery(event)

  const page = Number(query.page ?? 1)
  const pageSize = Number(query.pageSize ?? DEFAULT_PAGE_SIZE)
  if (!Number.isInteger(page) || page < 1) {
    throw createError({ statusCode: 400, statusMessage: 'page phải là số nguyên từ 1 trở lên.' })
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw createError({ statusCode: 400, statusMessage: `pageSize phải là số nguyên từ 1 đến ${MAX_PAGE_SIZE}.` })
  }

  const from = parseDay(query.from, 'from')
  const toDay = parseDay(query.to, 'to')
  // The end day is inclusive: everything before 00:00 +07:00 of the NEXT day.
  const toExclusive = toDay ? new Date(toDay.getTime() + DAY_MS) : null
  if (from && toDay && from.getTime() > toDay.getTime()) {
    throw createError({ statusCode: 400, statusMessage: 'Khoảng thời gian không hợp lệ: from phải trước to.' })
  }

  // An unrecognised value is refused rather than read as "no filter": a silent
  // fallback would show an unfiltered list while the control still reads
  // "Có thông tin liên hệ".
  const rawHasContact = query.hasContact === undefined ? '' : String(query.hasContact)
  if (rawHasContact !== '' && rawHasContact !== 'yes' && rawHasContact !== 'no') {
    throw createError({ statusCode: 400, statusMessage: "hasContact chỉ nhận giá trị rỗng, 'yes' hoặc 'no'." })
  }

  const db = getDb()
  const conditions = []
  if (from) conditions.push(gte(chatSessions.startedAt, from))
  if (toExclusive) conditions.push(lt(chatSessions.startedAt, toExclusive))
  if (rawHasContact === 'yes') conditions.push(isNotNull(chatSessions.detectedPhone))
  if (rawHasContact === 'no') conditions.push(sql`${chatSessions.detectedPhone} IS NULL`)
  const where = conditions.length ? and(...conditions) : undefined

  const [countRow] = await db.select({ total: sql<number>`COUNT(*)` }).from(chatSessions).where(where)
  const total = Number(countRow?.total ?? 0)

  const rows = await db
    .select({
      id: chatSessions.id,
      ip: chatSessions.ip,
      userAgent: chatSessions.userAgent,
      detectedPhone: chatSessions.detectedPhone,
      detectedName: chatSessions.detectedName,
      messageCount: chatSessions.messageCount,
      startedAt: chatSessions.startedAt,
      lastMessageAt: chatSessions.lastMessageAt,
    })
    .from(chatSessions)
    .where(where)
    // Tie-broken by id so pagination is stable when rows share a timestamp.
    .orderBy(desc(chatSessions.lastMessageAt), desc(chatSessions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'read',
    resource: 'chat_sessions',
    meta: {
      filters: { from: query.from ?? null, to: query.to ?? null, hasContact: rawHasContact || null },
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
      ip: row.ip,
      browser: summarizeUserAgent(row.userAgent),
      detectedPhone: row.detectedPhone,
      detectedName: row.detectedName,
      messageCount: row.messageCount,
      startedAt: row.startedAt,
      lastMessageAt: row.lastMessageAt,
    })),
  }
})
