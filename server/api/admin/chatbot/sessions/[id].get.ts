/**
 * One visitor chat session: metadata, full transcript, and any prior contact
 * submissions that share the detected phone number.
 *
 * The cross-link is why the phone is detected at all. A visitor who asked the
 * bot something and later filled in the contact form is one person with one
 * problem, and a case handler who cannot see both halves will call them back to
 * ask what they already typed.
 *
 * Matching is done on digits, not on the stored string: the form accepts
 * "0903 480 985", "+84903480985" and "0903480985" as the same number, so a
 * literal comparison would miss most real matches.
 */

import { asc, eq, sql, desc } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, chatMessages, chatSessions, submissions } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
import { summarizeUserAgent } from '../../../../utils/chatbot/user-agent'

/** Enough transcript for review without letting one long session blow up the
 *  response. Sessions past this are truncated with a flag, never silently. */
const MAX_TRANSCRIPT = 500

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'chatbot_knowledge', 'read')

  const sessionId = getRouterParam(event, 'id') ?? ''
  if (!sessionId || sessionId.length > 36) {
    throw createError({ statusCode: 400, statusMessage: 'Mã phiên không hợp lệ.' })
  }

  const db = getDb()

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1)

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy phiên trò chuyện.' })
  }

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
    .limit(MAX_TRANSCRIPT + 1)

  const truncated = messages.length > MAX_TRANSCRIPT
  if (truncated) messages.length = MAX_TRANSCRIPT

  // Compare the last 9 digits: that is the part shared by every Vietnamese
  // mobile format once the leading 0 / 84 / +84 is stripped.
  let relatedSubmissions: Array<{
    id: number
    fullName: string
    phone: string
    email: string | null
    formTitle: string | null
    createdAt: Date | null
  }> = []

  if (session.detectedPhone) {
    const digits = session.detectedPhone.replace(/\D/g, '')
    const tail = digits.slice(-9)
    if (tail.length === 9) {
      relatedSubmissions = await db
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
    }
  }

  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'read',
    resource: 'chat_sessions',
    meta: { sessionId, ip: getClientIp(event) },
  })

  return {
    ok: true,
    session: {
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      browser: summarizeUserAgent(session.userAgent),
      detectedPhone: session.detectedPhone,
      detectedName: session.detectedName,
      messageCount: session.messageCount,
      startedAt: session.startedAt,
      lastMessageAt: session.lastMessageAt,
    },
    messages,
    truncated,
    relatedSubmissions,
  }
})
