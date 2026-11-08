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
import { requireReader } from '../../../utils/reader-auth'
import { listReaderChatSummaries } from '../../../services/public-reader-queries'

// At most 20 conversations, titled by the visitor's first question (its first 120
// characters) — the query and why its subquery writes the table names out are in
// listReaderChatSummaries.
export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const rows = await listReaderChatSummaries(reader.id)

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
