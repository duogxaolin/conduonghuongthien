/**
 * The public side of a comment thread: the field-by-field public projection
 * (`serializePublicComment`) and the two-pass thread read (`loadCommentThread`).
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file.
 *
 * The two functions stay in ONE file on purpose: `loadCommentThread` reads the
 * reader-name columns and resolves them only through `serializePublicComment`,
 * and the reader-name guard (`tests/reader-name-resolver-guard.test.ts`) follows
 * that one hop only between functions of the same file.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments, readerAccounts } from '../db/schema'
import { effectiveDisplayName, initialsFrom } from '../utils/display-name'
import { resolveCommentTarget } from './comments-rules'

/** Display name shown for every administrator reply — see serializePublicComment. */
export const ADMIN_REPLY_DISPLAY_NAME = 'Ban quản trị'

/** Re-exported from utils/display-name.ts, which owns every decision about how a
 *  reader is named and drawn. Kept exported from the comment service (through
 *  the comments.ts barrel) so the existing call sites and
 *  tests/comment-validation.test.ts keep one import path. */
export { initialsFrom }

export type CommentRow = {
  id:           number
  /** Null for a media comment. `serializePublicComment` never reads it — the
   *  public projection must not disclose which article a comment belongs to. */
  articleId:    number | null
  readerId:     number | null
  adminUserId:  number | null
  parentId:     number | null
  body:         string
  createdAt:    Date | null
  // BOTH name columns, never just one: `display_name` is refreshed from Google on
  // every sign-in and `custom_display_name` holds what the reader chose, so either
  // one alone renders a name that is wrong for half the readers. Reconciled by
  // effectiveDisplayName — see utils/display-name.ts.
  readerName:       string | null
  readerCustomName: string | null
  /** The Google name is a reserved term → "Bạn đọc" (spec reader-display-names-google). */
  readerNameReserved: boolean | null
}

export type PublicComment = {
  id:           number
  authorName:   string
  initials:     string
  isAdminReply: boolean
  body:         string
  createdAt:    string | null
  canDelete:    boolean
  parentId:     number | null
  replies?:     PublicComment[]
}

/**
 * Explicit field projection — never a table spread.
 *
 * `article_comments` carries `ip` and `user_agent`, and `reader_accounts`
 * carries `email`. Spreading a row would publish all three the first time
 * somebody widened the select, with nothing failing. Listing the fields by hand
 * means a new column has to be *asked for* before it can escape.
 *
 * An administrator reply always shows the fixed portal label, never the
 * officer's account name or email: the reply is the portal speaking, and naming
 * the individual officer both misrepresents that and exposes staff identities on
 * a public page.
 */
export function serializePublicComment(row: CommentRow, viewerReaderId: number | null): PublicComment {
  const isAdminReply = row.adminUserId !== null
  const authorName = isAdminReply
    ? ADMIN_REPLY_DISPLAY_NAME
    : effectiveDisplayName({ customDisplayName: row.readerCustomName, displayName: row.readerName, displayNameReserved: row.readerNameReserved })

  return {
    id:           row.id,
    authorName,
    initials:     initialsFrom(authorName),
    isAdminReply,
    body:         row.body,
    createdAt:    row.createdAt ? row.createdAt.toISOString() : null,
    // Readers may remove only their own comment. An administrator reply is never
    // deletable from the public side, whoever is looking at it.
    canDelete:    !isAdminReply && viewerReaderId !== null && row.readerId === viewerReaderId,
    parentId:     row.parentId,
  }
}

export type ThreadPage = {
  comments:   PublicComment[]
  total:      number
  page:       number
  perPage:    number
  totalPages: number
}

/** Server-enforced ceiling — a client-supplied page size is a request, not a
 *  decision. */
export const COMMENT_MAX_PER_PAGE = 50

/**
 * Reads one page of top-level comments with their replies attached.
 *
 * Two passes, never a recursion: the one-level rule means the reply set is
 * exactly "rows whose parent is on this page", so a second query finishes the
 * job with a bounded cost regardless of thread size.
 *
 * Takes `articleId` / `mediaItemId` — the same two optional identifiers
 * `CreateCommentInput` takes — and resolves them with the same
 * `resolveCommentTarget` guard. One shape for the whole engine means a caller
 * that can write to a thread can read it with the argument it already has, and
 * there is no second vocabulary for the same idea.
 *
 * The item is branched in **both** passes below. Branching only the count query
 * would page an article's comments by a total computed from videos, and
 * branching only the reply query would attach replies from a different item to
 * this page's parents — either way the thread renders and the numbers look
 * plausible, which is what makes a half-branched read so easy to ship.
 */
export async function loadCommentThread(params: {
  articleId?:      number | null
  mediaItemId?:    number | null
  page:            number
  perPage:         number
  viewerReaderId:  number | null
}): Promise<ThreadPage> {
  const db = getDb()
  const { perPage, viewerReaderId } = params

  const resolved = resolveCommentTarget(params.articleId, params.mediaItemId)

  /**
   * No item, or both. Unreachable from either caller — both endpoints resolve a
   * slug to a row and check its status before asking for its thread — so this
   * branch is a read of nothing rather than a hidden refusal. It returns the
   * same empty page the callers already return for an unknown slug, which is the
   * established contract of this read path; throwing here would be a new way for
   * a page to fail, and no existing caller can reach it.
   */
  if (!resolved.ok) {
    return { comments: [], total: 0, page: 1, perPage, totalPages: 1 }
  }
  const target = resolved.target

  /**
   * `eq(column, null)` never matches — Drizzle renders it as `= NULL`, which is
   * unknown in SQL rather than true, so a media thread would silently come back
   * empty instead of erroring. The null branch has to be `isNull`.
   *
   * The other column is pinned to NULL as well, not left unconstrained: the
   * schema allows both to be set at once only because a CHECK constraint is not
   * available here, so the read enforces the XOR the write guard promises. A row
   * that somehow carried both would otherwise appear in two threads at once.
   */
  const scoped = target.kind === 'article'
    ? and(eq(articleComments.articleId, target.articleId), isNull(articleComments.mediaItemId))
    : and(eq(articleComments.mediaItemId, target.mediaItemId), isNull(articleComments.articleId))

  const topLevel = and(scoped, isNull(articleComments.parentId), eq(articleComments.isHidden, false))

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(articleComments)
    .where(topLevel)

  const total = Number(countRow?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(params.page, totalPages)

  const selection = {
    id:          articleComments.id,
    articleId:   articleComments.articleId,
    readerId:    articleComments.readerId,
    adminUserId: articleComments.adminUserId,
    parentId:    articleComments.parentId,
    body:        articleComments.body,
    createdAt:   articleComments.createdAt,
    readerName:       readerAccounts.displayName,
    readerCustomName: readerAccounts.customDisplayName,
    readerNameReserved: readerAccounts.displayNameReserved,
  }

  const topRows = await db
    .select(selection)
    .from(articleComments)
    .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
    .where(topLevel)
    .orderBy(articleComments.createdAt, articleComments.id)
    .limit(perPage)
    .offset((page - 1) * perPage)

  const parents = topRows.map(row => serializePublicComment(row, viewerReaderId))
  const byId = new Map<number, PublicComment>()
  for (const parent of parents) {
    parent.replies = []
    byId.set(parent.id, parent)
  }

  if (parents.length) {
    // The parent ids already come from this item, so scoping by them is enough
    // on its own — the item clause is kept anyway so the two passes read as the
    // same query rather than two that happen to agree today.
    const replyRows = await db
      .select(selection)
      .from(articleComments)
      .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
      .where(and(scoped, inArray(articleComments.parentId, parents.map(parent => parent.id)), eq(articleComments.isHidden, false)))
      .orderBy(articleComments.createdAt, articleComments.id)

    for (const row of replyRows) {
      const parent = row.parentId === null ? undefined : byId.get(row.parentId)
      if (parent) parent.replies!.push(serializePublicComment(row, viewerReaderId))
    }
  }

  return { comments: parents, total, page, perPage, totalPages }
}
