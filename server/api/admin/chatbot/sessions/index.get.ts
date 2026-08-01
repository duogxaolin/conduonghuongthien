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

import { and, desc, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, chatSessions } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
import { summarizeUserAgent } from '../../../../utils/chatbot/user-agent'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Rejects rather than clamping: quietly substituting a different range would
 *  make the response a lie about which period was reviewed. */
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

  const from = parseDate(query.from as string | undefined, 'from')
  const to = parseDate(query.to as string | undefined, 'to')
  if (from && to && from.getTime() > to.getTime()) {
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
  if (to) conditions.push(lte(chatSessions.startedAt, to))
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
