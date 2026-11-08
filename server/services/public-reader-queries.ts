/**
 * Queries of the signed-in reader's own endpoints — `reader/chats.get.ts`,
 * `reader/claim-chats.post.ts`, `reader/comments.get.ts` and `reader/logout.post.ts` — moved out
 * of the handlers verbatim: the same statements, in the same order, none of them in a
 * transaction (claim-chats is one UPDATE then one SELECT; logout one UPDATE), none audited (a
 * citizen acting on their own data — see the handlers).
 *
 * The handlers keep everything that needs the request: the reader session (`requireReader` /
 * `optionalReader` — the identity is never a parameter a caller can aim), the ticket check of a
 * claim (`verifySessionToken`, the analytics secret, the 50-ticket cap, the body), the page
 * clamp between the comment count and the comment rows, the response shaping, the logout's
 * failure log and `clearReaderCookie`.
 *
 * Imports `getDb` and nothing else from the database layer: tests/reader-session-boundary.test.ts
 * fakes that module with `getDb` alone.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments, articles, chatSessions, readerAccounts } from '../db/schema'

/** Server-enforced ceiling; the page shows a short list, not an archive. */
const MAX_SESSIONS = 20

/** Enough of the opening question to recognise the conversation by. */
const PREVIEW_CHARS = 120

/** `GET /api/public/reader/chats`: the reader's conversations, most recent first — a summary, never the transcript. */
export async function listReaderChatSummaries(readerId: number) {
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
    .where(eq(chatSessions.readerId, readerId))
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(MAX_SESSIONS)

  return rows
}

/**
 * `POST /api/public/reader/claim-chats`: attach the VERIFIED session ids `ids` that nobody owns
 * yet to `readerId`, then return the rows among `ids` the reader now owns.
 */
export async function claimChatSessionsForReader(readerId: number, ids: string[]) {
  /**
   * One UPDATE with `reader_id IS NULL` in the WHERE clause, not read-then-write.
   *
   * The condition is what makes the "cannot be taken from someone" rule hold under
   * two calls arriving at once: checking ownership in a SELECT first would let both
   * see null and both write. Here the database decides, once.
   */
  await getDb()
    .update(chatSessions)
    .set({ readerId })
    .where(and(inArray(chatSessions.id, ids), isNull(chatSessions.readerId)))

  /**
   * Count by asking what the reader now owns among the ids they proved, rather
   * than trusting `affectedRows`.
   *
   * `affectedRows` counts rows CHANGED, so a conversation this reader had already
   * claimed on a previous visit counts as zero — and the page would say "claimed
   * 0" while displaying the conversation immediately below. The reader's question
   * is "are my conversations here", not "did a row change on this request".
   */
  const owned = await getDb()
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(inArray(chatSessions.id, ids), eq(chatSessions.readerId, readerId)))

  return owned
}

/**
 * The reader's comments that are not hidden — a comment hidden from the public page is not one
 * of "my public comments" either. One condition for the count and the rows.
 */
function ownVisibleComments(readerId: number) {
  return and(eq(articleComments.readerId, readerId), eq(articleComments.isHidden, false))
}

/** `GET /api/public/reader/comments`: how many comments the list has. */
export async function countReaderComments(readerId: number) {
  const db = getDb()

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(articleComments)
    .where(ownVisibleComments(readerId))

  return countRow
}

/** `GET /api/public/reader/comments`: one page of them, newest first, with the article each sits under. */
export async function listReaderCommentRows(readerId: number, page: number, perPage: number) {
  const db = getDb()

  const rows = await db
    .select({
      id:           articleComments.id,
      body:         articleComments.body,
      createdAt:    articleComments.createdAt,
      parentId:     articleComments.parentId,
      articleTitle: articles.title,
      articleSlug:  articles.slug,
      articleStatus: articles.status,
      commentsEnabled: articles.commentsEnabled,
      // How many replies sit under this comment. The one-level rule means this is
      // a count, not a tree — a reader wants to know whether the portal answered,
      // and inlining the replies would put administrator text on a page whose
      // whole job is showing the reader their own words.
      replyCount: sql<number>`(SELECT COUNT(*) FROM \`article_comments\` \`r\` WHERE \`r\`.\`parent_id\` = \`article_comments\`.\`id\`)`,
    })
    .from(articleComments)
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
    .where(ownVisibleComments(readerId))
    .orderBy(desc(articleComments.createdAt), desc(articleComments.id))
    .limit(perPage)
    .offset((page - 1) * perPage)

  return rows
}

/**
 * `POST /api/public/reader/logout`: revoke every ticket issued to `readerId` so far.
 *
 * An increment in SQL, not `reader.tokenVersion + 1`: whatever version a
 * concurrent request just wrote, every ticket minted before this point stops
 * matching.
 */
export async function bumpReaderTokenVersion(readerId: number) {
  await getDb()
    .update(readerAccounts)
    .set({ tokenVersion: sql`${readerAccounts.tokenVersion} + 1` })
    .where(eq(readerAccounts.id, readerId))
}
