/**
 * The moderation side of comments: the officer's list (`listCommentsForAdmin`)
 * and the audit row recording that somebody read it (`auditCommentRead`).
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file. Deleting from this
 * list goes through the single deletion path in comments-deletion.ts; an
 * official reply through comments-admin-reply.ts.
 *
 * This file writes no row of its own — only the read audit, which has nothing to
 * be atomic with — so it is named in `SERVICE_EXEMPTIONS` of
 * `tests/reader-audit-atomicity.test.ts`, and that test also checks the premise
 * (no row write here) still holds.
 */

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articleComments, articles, mediaItems, readerAccounts, users } from '../db/schema'
import { effectiveDisplayName } from '../utils/display-name'
import type { CommentSource } from './comments-rules'
import { COMMENT_MAX_PER_PAGE } from './comments-thread'

export type AdminCommentRow = {
  id:           number
  body:         string
  createdAt:    Date | null
  parentId:     number | null
  /** Null for a media comment. Exactly one of `articleId` / `mediaItemId` is
   *  set, so the moderation screen always has something to name the item by. */
  articleId:    number | null
  articleTitle: string | null
  articleSlug:  string | null
  /** The mirror of the three article columns above. Null for an article comment. */
  mediaItemId:      number | null
  mediaItemTitle:   string | null
  mediaItemSlug:    string | null
  mediaItemShortId: string | null
  readerId:     number | null
  readerName:   string | null
  /** The raw Google column, kept on the row so /admin/readers/[id] can show what
   *  the account was originally called next to the chosen name. */
  readerCustomName: string | null
  /** Google name is a reserved term — the public sees "Bạn đọc", and so does this list. */
  readerNameReserved: boolean | null
  readerEmail:  string | null
  adminUserId:  number | null
  adminName:    string | null
  ip:           string | null
  isHidden:     boolean
  flagReason:   string | null
}

export type AdminCommentList = {
  comments:   AdminCommentRow[]
  total:      number
  page:       number
  perPage:    number
  totalPages: number
}

/**
 * The moderation list. Unlike the public projection this one DOES carry the
 * reader's email and address — that is the point of a moderation surface, and it
 * is why the endpoint above it demands `comments.read` and writes an audit row.
 *
 * Newest first: an officer opening this page is looking for what just arrived.
 *
 * `articleId` and `source` are two ways of narrowing the same list, and they
 * compose: `articleId` alone is "this article's comments", `source` alone is
 * "every comment on a video" or "every comment on an article", and both together
 * are still a coherent question. `source` is parsed by `parseCommentSource`
 * rather than compared here, so an unknown value is refused by the caller
 * instead of quietly widening the result.
 */
export async function listCommentsForAdmin(params: {
  articleId:  number | null
  source?:    CommentSource | null
  visibility?: 'visible' | 'hidden' | 'all'
  page:       number
  perPage:    number
}): Promise<AdminCommentList> {
  const db = getDb()

  const conditions = []
  if (params.articleId !== null) conditions.push(eq(articleComments.articleId, params.articleId))
  // `source=media` means "on a media item", which is the media column being set
  // — not the article column being null. Those differ for a row that carries
  // neither, which the write guard prevents but the read should not depend on.
  if (params.source === 'media') conditions.push(isNotNull(articleComments.mediaItemId))
  if (params.source === 'article') conditions.push(isNotNull(articleComments.articleId))
  // Mặc định `visible`: comment ẩn chỉ hiện ở tab "Đã ẩn". `all` chỉ dành cho
  // trường hợp officer muốn xem toàn bộ —但目前 UI không expose, giữ phòng sau.
  if (params.visibility !== 'all') {
    const wantHidden = params.visibility === 'hidden'
    conditions.push(eq(articleComments.isHidden, wantHidden))
  }
  const where = conditions.length ? and(...conditions) : undefined

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(articleComments)
    .where(where)

  const total = Number(countRow?.total ?? 0)
  const perPage = Math.min(Math.max(1, params.perPage), COMMENT_MAX_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(1, params.page), totalPages)

  const rows = await db
    .select({
      id:           articleComments.id,
      body:         articleComments.body,
      createdAt:    articleComments.createdAt,
      parentId:     articleComments.parentId,
      articleId:    articleComments.articleId,
      articleTitle: articles.title,
      articleSlug:  articles.slug,
      mediaItemId:      articleComments.mediaItemId,
      mediaItemTitle:   mediaItems.title,
      mediaItemSlug:    mediaItems.slug,
      mediaItemShortId: mediaItems.shortId,
      readerId:     articleComments.readerId,
      readerName:       readerAccounts.displayName,
      readerCustomName: readerAccounts.customDisplayName,
      readerNameReserved: readerAccounts.displayNameReserved,
      readerEmail:  readerAccounts.email,
      adminUserId:  articleComments.adminUserId,
      adminName:    users.username,
      ip:           articleComments.ip,
      isHidden:     articleComments.isHidden,
      flagReason:   articleComments.flagReason,
    })
    .from(articleComments)
    /**
     * leftJoin on BOTH item tables, and neither is decoration.
     *
     * The `articles` join is load-bearing for media comments: a media comment has
     * `article_id = NULL`, so an inner join there would drop every video comment
     * from the moderation screen while the screen still rendered, still paged, and
     * still reported a plausible total. The officer's only clue would be that the
     * comments they can see on the video are missing from the list meant to
     * moderate them.
     *
     * The `media_items` join is the mirror. The FK is ON DELETE CASCADE, so a
     * deleted item normally takes its comments with it — but the row that survives
     * anyway (an item archived rather than deleted, a bulk operation with foreign
     * key checks off, an identifier left pointing at nothing) is exactly the row an
     * officer most needs to see: it is unattributable from every other screen, and
     * an inner join would answer that by hiding it. Same precedent as the `users`
     * join below, which keeps rows for deleted accounts.
     */
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
    .leftJoin(mediaItems, eq(articleComments.mediaItemId, mediaItems.id))
    .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
    // leftJoin, and adminUserId is SET NULL on user deletion: a portal reply
    // survives the officer who wrote it, showing no author rather than vanishing.
    .leftJoin(users, eq(articleComments.adminUserId, users.id))
    .where(where)
    .orderBy(desc(articleComments.createdAt), desc(articleComments.id))
    .limit(perPage)
    .offset((page - 1) * perPage)

  return {
    // `readerName` is resolved to the name the PUBLIC sees, not the raw Google
    // column. An officer acting on a report about "Bác Ba" has to be able to find
    // the row that says "Bác Ba"; a moderation list showing a different name from
    // the thread it moderates is a list that cannot be used for its one job.
    comments: rows.map(row => ({
      ...row,
      readerName: row.readerId === null
        ? null
        : effectiveDisplayName({ customDisplayName: row.readerCustomName, displayName: row.readerName, displayNameReserved: row.readerNameReserved }),
    })),
    total,
    page,
    perPage,
    totalPages,
  }
}

/**
 * Record that somebody read the moderation comment list.
 *
 * Same reasoning as auditReaderRead: these rows carry citizens' names, addresses
 * and email, and a log of personal data that can be browsed silently is a
 * surveillance tool rather than an audit log (design.md D14).
 */
export async function auditCommentRead(params: { actorId: number, meta: Record<string, unknown> }): Promise<void> {
  await getDb().insert(activityLogs).values({
    userId:   params.actorId,
    action:   'read',
    resource: 'comments',
    meta:     params.meta,
  })
}
