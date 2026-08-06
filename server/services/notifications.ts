/**
 * Reader notifications — "somebody replied to you".
 *
 * The comment thread was one-way before this existed: a citizen asked a question
 * under an article and left, and the portal's official answer never reached them.
 * That is the failure this module fixes, so the two rules below are the ones that
 * matter most and the ones easiest to undo by accident.
 *
 *   1. **A notification is written in the SAME transaction as the reply.** Both
 *      call sites in services/comments.ts pass their `tx` handle down. A reply
 *      that exists with nobody told about it is exactly the state this feature
 *      was built to prevent, and a fire-and-forget insert next to the reply
 *      produces that state every time the second statement fails.
 *   2. **The link has to land on the actual comment.** A notification points at a
 *      *reply*, but the thread paginates over *top-level* comments — so the page
 *      number has to be computed from the reply's parent. Without it, every
 *      notification about an older question opens page 1 and shows nothing, which
 *      reads as the portal having deleted what the reader wrote.
 *
 * Nothing here writes `activity_logs`. The rule that every read of reader data is
 * audited (design.md D14) targets OFFICERS reading citizens' data; a reader
 * looking at their own notifications is not that, and logging it would bury the
 * rows the table exists for. Same reasoning as GET /api/public/reader/comments.
 */

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { articleComments, articles, readerNotifications } from '../db/schema'

/** The only kind today. Stored in a column so a second kind (a new article in a
 *  followed topic) does not need a migration to exist. */
export const NOTIFICATION_TYPE_REPLY = 'comment_reply'

/**
 * Page size of the public comment thread.
 *
 * Lives HERE and is imported by the thread endpoint, rather than being declared
 * in both places. `notificationTargetPage` below converts a comment's position
 * into a page number, and if that arithmetic used a different page size from the
 * endpoint actually serving the thread, every deep link would be off by however
 * far the two numbers had drifted — landing readers next to their comment instead
 * of on it, with nothing failing anywhere.
 */
export const COMMENT_THREAD_PER_PAGE = 20

/** Long enough to recognise the reply, short enough that the dropdown stays a
 *  list rather than becoming the thread itself. Cut on the SERVER so a long body
 *  is never shipped to a client that only renders 140 characters of it. */
export const NOTIFICATION_EXCERPT_LENGTH = 140

/**
 * Shorten a body for the notification list without cutting mid-word.
 *
 * Pure, and separated from every query, because it is the piece with edge cases:
 * a body shorter than the limit must come back untouched (no stray ellipsis), and
 * a body with no space in the first 140 characters must still be cut somewhere
 * rather than falling back to the whole thing.
 */
export function buildExcerpt(body: string, limit = NOTIFICATION_EXCERPT_LENGTH): string {
  // Newlines become spaces: the excerpt renders on one clamped line, and a body
  // whose first line is short would otherwise look like the entire reply.
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat

  const cut = flat.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  // Only honour the word boundary if it is reasonably far in; a single long token
  // would otherwise collapse the excerpt to almost nothing.
  const base = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

/**
 * Which page of the thread a top-level comment sits on.
 *
 * `olderCount` is how many top-level comments on the same article sort before it.
 * Pure so the arithmetic can be tested without a database — this is the value
 * that decides whether a notification link works at all.
 */
export function notificationTargetPage(olderCount: number, perPage = COMMENT_THREAD_PER_PAGE): number {
  if (!Number.isFinite(olderCount) || olderCount < 0) return 1
  if (!Number.isFinite(perPage) || perPage < 1) return 1
  return Math.floor(olderCount / perPage) + 1
}

export type ReplyNotificationInput = {
  /** The reply that was just written. */
  commentId: number
  /** The comment it answers. Null means a top-level comment — nothing to notify. */
  parentId: number | null
  /** Who wrote the reply, or null when the portal did (an administrator reply). */
  actorReaderId: number | null
  /** Insert on the caller's transaction so the reply and the notice commit together. */
  tx?: Pick<ReturnType<typeof getDb>, 'select' | 'insert'>
}

/**
 * Tell the author of `parentId` that someone answered them.
 *
 * Returns the id of the notified reader, or null when there was nobody to tell —
 * which is a normal outcome, not a failure: a top-level comment notifies nobody,
 * an administrator reply's parent might be another administrator reply, and a
 * reader replying to their own comment must not be told about themselves.
 *
 * The insert IGNOREs a duplicate rather than checking first. The UNIQUE index is
 * the authority; a read-then-write here would let two concurrent replies both see
 * "no row yet" and both insert.
 */
export async function createReplyNotification(input: ReplyNotificationInput): Promise<number | null> {
  if (input.parentId === null) return null

  const executor = input.tx ?? getDb()

  const [parent] = await executor
    .select({ readerId: articleComments.readerId })
    .from(articleComments)
    .where(eq(articleComments.id, input.parentId))
    .limit(1)

  const recipientId = parent?.readerId ?? null

  // No recipient: the parent is an administrator reply (reader_id NULL), or the
  // author's account has since been deleted.
  if (recipientId === null) return null

  // Replying to yourself. Announcing it would be noise arriving from nobody, and
  // it would inflate the unread badge for the one person who already knows.
  if (input.actorReaderId !== null && recipientId === input.actorReaderId) return null

  await executor
    .insert(readerNotifications)
    .values({
      readerId:  recipientId,
      commentId: input.commentId,
      type:      NOTIFICATION_TYPE_REPLY,
      // Drizzle query builder, never pool.query — design.md D17. `created_at` is
      // a timezone-less DATETIME and Drizzle's writer/reader pair is only
      // self-inverse when both halves are used.
      createdAt: new Date(),
    })
    // Honours reader_notifications_reader_comment_uq: one reply announces itself
    // exactly once, whatever retries happen above this call.
    .onDuplicateKeyUpdate({ set: { commentId: sql`\`comment_id\`` } })

  return recipientId
}

/** How many unread notices the reader has. Drives the header badge. */
export async function countUnread(readerId: number): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`COUNT(*)` })
    .from(readerNotifications)
    .where(and(eq(readerNotifications.readerId, readerId), eq(readerNotifications.isRead, false)))

  return Number(row?.total ?? 0)
}

export type NotificationItem = {
  id:        number
  isRead:    boolean
  createdAt: string | null
  /** Who wrote the reply, as the public sees them. */
  authorName:   string
  isAdminReply: boolean
  excerpt:      string
  /**
   * Where to go. Null when the reply can no longer be reached — an unpublished
   * article, or comments turned off (which hides the thread without deleting
   * rows, design.md D10). The list says so rather than handing over a link that
   * silently shows nothing.
   */
  target: {
    articleTitle: string
    url:          string
  } | null
}

export type NotificationPage = {
  items:       NotificationItem[]
  total:       number
  unreadCount: number
  page:        number
  perPage:     number
  totalPages:  number
}

/**
 * One page of the reader's notifications, newest first.
 *
 * The `olderCount` subquery is what makes the link work: for each notification it
 * counts the top-level comments on the same article that sort BEFORE the thread
 * root, using the very ordering `loadCommentThread` applies — `(created_at, id)`,
 * with `id` breaking ties so two comments written in the same second cannot land
 * a reader on the wrong page.
 *
 * `rootId` is the reply's parent when it has one. Replies are never paginated
 * themselves (the one-level rule means they always render under their parent), so
 * the page to open is always the parent's page.
 */
export async function listNotifications(params: {
  readerId: number
  page:     number
  perPage:  number
}): Promise<NotificationPage> {
  const db = getDb()
  const { readerId, perPage } = params

  const where = eq(readerNotifications.readerId, readerId)

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(readerNotifications)
    .where(where)

  const total = Number(countRow?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(1, params.page), totalPages)

  // Aliased so the row for the reply and the row for its parent can both be read
  // in one pass. `parent` is the thread root the link has to open.
  const rows = await db
    .select({
      id:        readerNotifications.id,
      isRead:    readerNotifications.isRead,
      createdAt: readerNotifications.createdAt,
      body:        articleComments.body,
      adminUserId: articleComments.adminUserId,
      commentReaderId: articleComments.readerId,
      parentId:    articleComments.parentId,
      articleTitle:    articles.title,
      articleSlug:     articles.slug,
      articleStatus:   articles.status,
      commentsEnabled: articles.commentsEnabled,
      /**
       * Position of the thread root among that article's top-level comments.
       *
       * COALESCE(parent_id, id): a notification always points at a reply, but
       * guarding the top-level case here means a future notification kind that
       * points at a root comment gets a correct page for free instead of a
       * silently wrong one.
       */
      olderCount: sql<number>`(
        SELECT COUNT(*) FROM \`article_comments\` \`older\`
        WHERE \`older\`.\`article_id\` = \`article_comments\`.\`article_id\`
          AND \`older\`.\`parent_id\` IS NULL
          AND (
            \`older\`.\`created_at\` < \`root\`.\`created_at\`
            OR (\`older\`.\`created_at\` = \`root\`.\`created_at\` AND \`older\`.\`id\` < \`root\`.\`id\`)
          )
      )`,
      rootId: sql<number>`\`root\`.\`id\``,
      authorName: sql<string | null>`\`author\`.\`custom_display_name\``,
      authorGoogleName: sql<string | null>`\`author\`.\`display_name\``,
    })
    .from(readerNotifications)
    .innerJoin(articleComments, eq(readerNotifications.commentId, articleComments.id))
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
    // The thread root: the reply's parent, or the comment itself when it has none.
    .leftJoin(
      sql`\`article_comments\` \`root\``,
      sql`\`root\`.\`id\` = COALESCE(\`article_comments\`.\`parent_id\`, \`article_comments\`.\`id\`)`,
    )
    .leftJoin(
      sql`\`reader_accounts\` \`author\``,
      sql`\`author\`.\`id\` = \`article_comments\`.\`reader_id\``,
    )
    .where(where)
    .orderBy(desc(readerNotifications.createdAt), desc(readerNotifications.id))
    .limit(perPage)
    .offset((page - 1) * perPage)

  const items: NotificationItem[] = rows.map((row) => {
    const isAdminReply = row.adminUserId !== null
    const targetPage = notificationTargetPage(Number(row.olderCount ?? 0))
    const readable = row.articleSlug !== null
      && row.articleStatus === 'published'
      && row.commentsEnabled === true

    return {
      id:        row.id,
      isRead:    Boolean(row.isRead),
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      // Administrator replies always show the fixed portal label, never the
      // officer's account name — the same rule serializePublicComment enforces.
      authorName: isAdminReply
        ? 'Ban quản trị'
        : (row.authorName || row.authorGoogleName || 'Người dùng'),
      isAdminReply,
      excerpt: buildExcerpt(row.body ?? ''),
      target: readable
        ? {
            articleTitle: row.articleTitle ?? '',
            /**
             * `/news/<slug>` whatever the article's type is — /news/[id].vue
             * looks up by slug with no type filter and is the only detail route
             * that renders every type. A per-type prefix would 404 exactly the
             * comments left on a legal document.
             *
             * `?binhluan=` carries the page so the thread opens where the comment
             * actually is; the hash names the comment within it.
             */
            url: `/news/${row.articleSlug}${targetPage > 1 ? `?binhluan=${targetPage}` : ''}#binh-luan-${row.rootId ?? row.id}`,
          }
        : null,
    }
  })

  return { items, total, unreadCount: await countUnread(readerId), page, perPage, totalPages }
}

/**
 * Mark notifications read.
 *
 * `readerId` is ALWAYS part of the predicate, never just the ids. Filtering on id
 * alone would let a caller mark somebody else's notifications read — a small
 * harm on its own, but it is the shape of query that later grows into reading
 * them.
 */
export async function markRead(params: { readerId: number, ids: number[] }): Promise<number> {
  const ids = params.ids.filter(id => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return 0

  await getDb()
    .update(readerNotifications)
    .set({ isRead: true })
    .where(and(eq(readerNotifications.readerId, params.readerId), inArray(readerNotifications.id, ids)))

  return ids.length
}

/** Mark everything unread as read. Bounded by the reader, same as markRead. */
export async function markAllRead(readerId: number): Promise<void> {
  await getDb()
    .update(readerNotifications)
    .set({ isRead: true })
    .where(and(eq(readerNotifications.readerId, readerId), eq(readerNotifications.isRead, false)))
}
