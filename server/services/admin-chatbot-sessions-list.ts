/**
 * The visitor chat session list for administrators (`GET /api/admin/chatbot/sessions`) — its
 * two reads and its read-audit row, moved out of the handler verbatim (2026-11-08: no
 * `server/api` file calls getDb() itself). The handler keeps the permission, parsing and
 * rejecting the filters (Vietnam calendar days, `hasContact`), the admin's IP and the shape of
 * the response.
 *
 * The read is recorded: these rows carry IP addresses and, when a visitor typed one, a phone
 * number. One audit row per request, written on the pool after the reads — there is no row
 * write to pair it with. This file writes nothing else (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in
 * `tests/reader-audit-atomicity.test.ts` checks that premise on every run).
 */
import { and, desc, gte, isNotNull, lt, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, chatSessions } from '../db/schema'

/** One page of sessions (newest message first) and the total under the same filters. */
export async function listChatSessionsPage(filters: {
  from: Date | null
  toExclusive: Date | null
  /** '' (any), 'yes' or 'no' — already validated by the handler. */
  hasContact: string
  page: number
  pageSize: number
}) {
  const { from, toExclusive, hasContact: rawHasContact, page, pageSize } = filters
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

  return { total, rows }
}

/** The audit row of one read of the list: who, which filters, from which IP. A failed insert fails the request. */
export async function auditChatSessionListRead(adminId: number, meta: { filters: { from: unknown, to: unknown, hasContact: string | null }, ip: string }) {
  await getDb().insert(activityLogs).values({
    userId: adminId,
    action: 'read',
    resource: 'chat_sessions',
    meta,
  })
}
