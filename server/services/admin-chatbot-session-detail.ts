/**
 * One visitor chat session for administrators (`GET /api/admin/chatbot/sessions/:id`) — its
 * reads (the session, the transcript, the contact submissions sharing the detected phone) and
 * its read-audit row, moved out of the handler verbatim (2026-11-08: no `server/api` file calls
 * getDb() itself). The handler keeps the permission, the id check, the 404, the truncation flag,
 * extracting the phone's last nine digits, the admin's IP and the shape of the response.
 * `findChatSessionById` is also the existence read of `DELETE /api/admin/chatbot/sessions/:id`.
 *
 * Reading a transcript is recorded: one audit row per request, written on the pool after the
 * reads — there is no row write to pair it with. This file writes nothing else
 * (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in `tests/reader-audit-atomicity.test.ts` checks that
 * premise on every run).
 */
import { asc, eq, sql, desc } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, chatMessages, chatSessions, submissions } from '../db/schema'

/** The session row with this id, if any. */
export async function findChatSessionById(sessionId: string) {
  const db = getDb()
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1)
  return session
}

/** The first `limit` turns of the session's transcript, oldest first. */
export async function listChatTranscript(sessionId: string, limit: number) {
  const db = getDb()
  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      kind: chatMessages.kind,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    // Ascending: a transcript read out of order is not a transcript. Tie-broken
    // by id because both turns of one exchange share a timestamp to the second.
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(limit)
  return messages
}

/**
 * The latest 20 contact submissions whose phone, digits only, ends with `tail` (the last nine
 * digits of the number detected in the chat). Matching is done on digits, not on the stored
 * string: the form accepts "0903 480 985", "+84903480985" and "0903480985" as the same number.
 */
export async function findSubmissionsByPhoneTail(tail: string) {
  const db = getDb()
  const rows = await db
    .select({
      id: submissions.id,
      fullName: submissions.fullName,
      phone: submissions.phone,
      email: submissions.email,
      formTitle: submissions.formTitle,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .where(sql`RIGHT(REGEXP_REPLACE(${submissions.phone}, '[^0-9]', ''), 9) = ${tail}`)
    .orderBy(desc(submissions.createdAt))
    .limit(20)
  return rows
}

/** The audit row of one read of a transcript: who, which session, from which IP. A failed insert fails the request. */
export async function auditChatSessionView(adminId: number, meta: { sessionId: string, ip: string }) {
  await getDb().insert(activityLogs).values({
    userId: adminId,
    action: 'read',
    resource: 'chat_sessions',
    meta,
  })
}
