/**
 * The conversations this reader has claimed.
 *
 * Identity from the ticket, no id parameter — same rule as comments.get.ts, and it
 * matters more here: a chat transcript can carry a phone number and a description
 * of somebody's own criminal record. Only rows whose `reader_id` equals the caller
 * are ever read.
 *
 * Not audited, for the reason set out in comments.get.ts: the audit rule targets
 * officers reading citizens' data (/admin/chatbot/sessions logs every view), not a
 * citizen reading their own.
 *
 * Returns a SUMMARY, never the transcript. The reader already has their own
 * messages in this browser's localStorage, and /profile only needs to show that
 * the conversation is attached to the account. Shipping full transcripts would put
 * every claimed conversation's text into a response that exists to render a list.
 */
import { desc, eq, sql } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { chatMessages, chatSessions } from '../../../db/schema'
import { requireReader } from '../../../utils/reader-auth'

/** Server-enforced ceiling; the page shows a short list, not an archive. */
const MAX_SESSIONS = 20

/** Enough of the opening question to recognise the conversation by. */
const PREVIEW_CHARS = 120

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)
  const db = getDb()

  const rows = await db
    .select({
      id:            chatSessions.id,
      messageCount:  chatSessions.messageCount,
      startedAt:     chatSessions.startedAt,
      lastMessageAt: chatSessions.lastMessageAt,
      /**
       * The visitor's FIRST question, as the conversation's title.
       *
       * A correlated subquery rather than a join: `chat_messages` has many rows per
       * session, so joining would multiply each session into one row per message
       * and the count above would be wrong.
       *
       * `role = 'user'` on purpose — titling a conversation with the assistant's
       * opening line would give every conversation the same title.
       *
       * ⚠️ TABLE NAMES ARE WRITTEN OUT, not interpolated from the schema objects,
       * and that is load-bearing. Drizzle only qualifies a column with its table
       * name when the surrounding query HAS A JOIN; without one it emits the bare
       * name. Written as `${chatMessages.sessionId} = ${chatSessions.id}` this
       * subquery compiles to `WHERE \`session_id\` = \`id\`` — and inside a
       * subquery over `chat_messages`, the bare `id` resolves to
       * `chat_messages.id`, not to the outer session. The correlation silently
       * stops correlating: MySQL raises no error, the subquery matches nothing,
       * and every conversation gets the fallback title. It looked like "the
       * fallback is being used" rather than like a broken query.
       *
       * The same expression IS correct in server/api/public/articles/[slug].get.ts
       * only because that query happens to carry two leftJoins. Relying on that is
       * relying on an unrelated part of the query staying the way it is.
       */
      firstQuestion: sql<string | null>`(
        SELECT LEFT(\`m\`.\`content\`, ${PREVIEW_CHARS})
        FROM \`chat_messages\` \`m\`
        WHERE \`m\`.\`session_id\` = \`chat_sessions\`.\`id\` AND \`m\`.\`role\` = 'user'
        ORDER BY \`m\`.\`created_at\` ASC, \`m\`.\`id\` ASC
        LIMIT 1
      )`,
    })
    .from(chatSessions)
    .where(eq(chatSessions.readerId, reader.id))
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(MAX_SESSIONS)

  return {
    ok: true,
    sessions: rows.map(row => ({
      id: row.id,
      // Plain text, rendered through `{{ }}` on the page — never v-html, same rule
      // as every other visitor-authored string on this portal.
      title: row.firstQuestion?.trim() || 'Cuộc trò chuyện',
      messageCount: Number(row.messageCount ?? 0),
      startedAt:     row.startedAt ? row.startedAt.toISOString() : null,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    })),
  }
})
