/**
 * Public comments — validation, the write path, and every deletion path.
 *
 * Three decisions from design.md (reader-google-login-comments) are load-bearing
 * here and each one is easy to undo by accident:
 *
 *   1. **A comment body is PLAIN TEXT and is never sanitised.** `<script>` in a
 *      body is stored verbatim and returned verbatim, because the public
 *      component renders it through `{{ }}` — HTML is never interpreted, so
 *      there is nothing to strip. Running sanitizeHtml here would silently
 *      rewrite what a reader wrote (angle brackets in a quoted regulation, a
 *      `&` in an office name) and the reader would be shown words they did not
 *      type. What replaces sanitising is a length bound and a control-character
 *      refusal — the two things that actually damage a plain-text render.
 *   2. **Exactly one reply level.** A reply's parent must itself have
 *      `parentId === null`. The check lives in a pure function
 *      (`checkParentEligibility`) so the rule is testable without a database;
 *      the depth limit is what keeps the thread renderable and the read query a
 *      fixed two passes rather than a recursion.
 *   3. **`createdAt` goes through the Drizzle query builder, never pool.query**
 *      (design.md D17). `article_comments.created_at` is a timezone-less
 *      DATETIME and Drizzle's writer/reader pair is only self-inverse when both
 *      halves are used. A raw query shifts every timestamp by the pool's
 *      timezone offset.
 *
 * There is deliberately **no update path**: nothing in this module, and no
 * endpoint anywhere, accepts a new body for an existing comment. A public
 * comment that can be rewritten after the fact is a record of nothing — a reply
 * from the portal could end up sitting under a question that no longer resembles
 * the one it answered. Correcting a comment means deleting it and posting again,
 * which leaves the thread honest about what happened.
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { activityLogs, articleComments, articles, readerAccounts, users } from '../db/schema'
import { isIpBanned } from '../utils/ip-ban'
import { loadIpBanValues } from './ip-bans'
import { recordRateLimitHit, type RateLimitRule } from '../utils/rate-limit-store'
import { effectiveDisplayName, initialsFrom } from '../utils/display-name'

/** Long enough for a real question, short enough that one row cannot dominate a page. */
export const COMMENT_MAX_LENGTH = 2000

/** Display name shown for every administrator reply — see serializePublicComment. */
export const ADMIN_REPLY_DISPLAY_NAME = 'Ban quản trị'

/** Per reader. Deliberately tighter than the address rule: one person writing
 *  five comments in ten minutes is already at the edge of a conversation. */
const COMMENT_READER_RULE: RateLimitRule = { limit: 5, windowSeconds: 600 }

/** Per address. Looser because a household, an office or a mobile carrier NAT
 *  puts many unrelated readers behind one address. */
const COMMENT_IP_RULE: RateLimitRule = { limit: 15, windowSeconds: 600 }

/**
 * Everything in the C0–C1F/7F range except LF (
) and TAB (	).
 *
 * Written with escapes, never as literal bytes: a literal control character in
 * source is invisible in every editor and diff, so the next person to touch this
 * line cannot see what it matches.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export type BodyValidation =
  | { ok: true, body: string }
  | { ok: false, message: string }

/**
 * Normalises and bounds a submitted body.
 *
 * CRLF collapses to LF so a Windows browser and a phone produce the same stored
 * bytes — otherwise the same paragraph counts differently against the limit
 * depending on what the reader typed it on. Control characters other than
 * newline and tab are refused rather than stripped: a body carrying them is
 * either a paste accident or a probe, and stripping would show the reader a
 * comment that is not what they submitted.
 */
export function validateBody(raw: unknown): BodyValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Nội dung bình luận không hợp lệ.' }

  const normalized = raw.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { ok: false, message: 'Vui lòng nhập nội dung bình luận.' }

  if (FORBIDDEN_CONTROL_CHARS.test(normalized)) {
    return { ok: false, message: 'Nội dung bình luận chứa ký tự không được phép.' }
  }

  if (normalized.length > COMMENT_MAX_LENGTH) {
    return { ok: false, message: `Nội dung bình luận quá dài (tối đa ${COMMENT_MAX_LENGTH} ký tự).` }
  }

  return { ok: true, body: normalized }
}

export type ParentCandidate = {
  id:        number
  articleId: number
  parentId:  number | null
}

export type ParentCheck =
  | { ok: true }
  | { ok: false, message: string }

/**
 * The one-level reply rule, as a pure function.
 *
 * Kept free of database access on purpose: this is the rule most likely to be
 * "simplified" during a later refactor, and a rule that can only be exercised
 * against a live MySQL server is a rule nobody exercises.
 */
export function checkParentEligibility(parent: ParentCandidate | null | undefined, articleId: number): ParentCheck {
  if (!parent) return { ok: false, message: 'Bình luận gốc không tồn tại.' }
  if (parent.articleId !== articleId) return { ok: false, message: 'Bình luận gốc không thuộc bài viết này.' }
  if (parent.parentId !== null) return { ok: false, message: 'Chỉ có thể trả lời bình luận gốc, không trả lời một phản hồi.' }
  return { ok: true }
}

/** Re-exported from utils/display-name.ts, which owns every decision about how a
 *  reader is named and drawn. Kept exported here so the existing call sites and
 *  tests/comment-validation.test.ts keep one import path. */
export { initialsFrom }

export type CommentRow = {
  id:           number
  articleId:    number
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
    : effectiveDisplayName({ customDisplayName: row.readerCustomName, displayName: row.readerName })

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

function limiterDeps() {
  const pool = getPool()
  return { execute: pool ? ((sql: string, params: unknown[]) => pool.query(sql, params)) : null }
}

async function loadIpBans(): Promise<string[]> {
  return loadIpBanValues()
}

export type CreateCommentInput = {
  readerId:  number
  articleId: number
  parentId:  number | null
  body:      string
  ip:        string | null
  userAgent: string | null
}

export type CreateCommentResult =
  | { ok: true, id: number }
  | { ok: false, statusCode: number, message: string, retryAfterSeconds?: number }

/**
 * Writes one comment, refusing in a fixed order.
 *
 * The order is the point. Every gate below is a reason the write must not
 * happen, and each is checked before **either** rate limit is charged — the two
 * `recordRateLimitHit` calls sit immediately before the insert. Charging earlier
 * would make a refusal cost allowance: a reader whose five attempts all landed
 * on a closed article, or all named a parent from another article, would be
 * locked out for ten minutes without a single comment existing. Worse, it hands
 * an attacker a way to exhaust someone else's allowance using requests that were
 * always going to fail. Allowance is spent on writes, not on refusals.
 */
export async function createComment(input: CreateCommentInput): Promise<CreateCommentResult> {
  const db = getDb()

  const [article] = await db
    .select({
      id:              articles.id,
      status:          articles.status,
      commentsEnabled: articles.commentsEnabled,
    })
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1)

  if (!article || article.status !== 'published') {
    return { ok: false, statusCode: 404, message: 'Bài viết không tồn tại.' }
  }
  if (!article.commentsEnabled) {
    return { ok: false, statusCode: 403, message: 'Bài viết này hiện không mở bình luận.' }
  }

  const [reader] = await db
    .select({ id: readerAccounts.id, isBanned: readerAccounts.isBanned })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, input.readerId))
    .limit(1)

  if (!reader) return { ok: false, statusCode: 401, message: 'Chưa đăng nhập' }
  if (reader.isBanned) {
    return { ok: false, statusCode: 403, message: 'Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.' }
  }

  if (isIpBanned(input.ip, await loadIpBans())) {
    return { ok: false, statusCode: 403, message: 'Địa chỉ của bạn đã bị hạn chế bình luận trên cổng thông tin.' }
  }

  if (input.parentId !== null) {
    const [parent] = await db
      .select({
        id:        articleComments.id,
        articleId: articleComments.articleId,
        parentId:  articleComments.parentId,
      })
      .from(articleComments)
      .where(eq(articleComments.id, input.parentId))
      .limit(1)

    const verdict = checkParentEligibility(parent ?? null, input.articleId)
    if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.message }
  }

  // ── Everything above was a reason to refuse. Only now is allowance spent. ──
  const deps = limiterDeps()
  const readerState = await recordRateLimitHit(`comment:reader:${input.readerId}`, COMMENT_READER_RULE, deps)
  if (readerState.blocked) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Bạn đã gửi quá nhiều bình luận. Vui lòng thử lại sau ít phút.',
      retryAfterSeconds: Math.max(1, readerState.retryAfterSeconds),
    }
  }

  const addressKey = input.ip && input.ip !== 'unknown' ? input.ip : 'anonymous'
  const ipState = await recordRateLimitHit(`comment:ip:${addressKey}`, COMMENT_IP_RULE, deps)
  if (ipState.blocked) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Đã có quá nhiều bình luận gửi từ địa chỉ này. Vui lòng thử lại sau ít phút.',
      retryAfterSeconds: Math.max(1, ipState.retryAfterSeconds),
    }
  }

  const inserted = await db.insert(articleComments).values({
    articleId: input.articleId,
    readerId:  input.readerId,
    parentId:  input.parentId,
    body:      input.body,
    ip:        input.ip,
    userAgent: (input.userAgent || '').slice(0, 512) || null,
    // Drizzle query builder, never pool.query — design.md D17.
    createdAt: new Date(),
  })

  // Destructured: db.insert() resolves to [ResultSetHeader, FieldPacket[]], so
  // `.insertId` on the array itself is undefined and `Number(undefined ?? 0)` is 0
  // — silently. Same trap as callback.get.ts and ip-bans.ts, guarded by
  // tests/insert-id-integration.test.ts.
  const [header] = inserted
  return { ok: true, id: Number(header?.insertId ?? 0) }
}

export type DeleteActor =
  | { kind: 'reader', readerId: number }
  | { kind: 'admin', userId: number }
  | { kind: 'system', reason: string }

export type DeleteCommentResult =
  | { ok: true, deleted: number }
  | { ok: false, statusCode: number, message: string }

/**
 * The single deletion path.
 *
 * Six callers share it — self-delete, admin delete, admin bulk delete, reader
 * ban, account deletion, and the retention purge — so that the audit row, the
 * reply cascade and the "an administrator reply is not reader-deletable" rule
 * exist in exactly one place. A second delete written next to one of those
 * callers is how one of the three quietly stops happening.
 *
 * Deleting a top-level comment takes its replies with it: the FK cascade on
 * `parentId` does that in the database (design.md D8), including administrator
 * replies, because a portal reply with nothing above it reads as an answer to a
 * question nobody asked.
 */
export async function deleteComment(params: { id: number, actor: DeleteActor }): Promise<DeleteCommentResult> {
  const db = getDb()

  const [row] = await db
    .select({
      id:          articleComments.id,
      articleId:   articleComments.articleId,
      readerId:    articleComments.readerId,
      adminUserId: articleComments.adminUserId,
      parentId:    articleComments.parentId,
    })
    .from(articleComments)
    .where(eq(articleComments.id, params.id))
    .limit(1)

  if (!row) return { ok: false, statusCode: 404, message: 'Bình luận không tồn tại.' }

  if (params.actor.kind === 'reader') {
    if (row.adminUserId !== null) {
      return { ok: false, statusCode: 403, message: 'Không thể xoá phản hồi của Ban quản trị.' }
    }
    if (row.readerId !== params.actor.readerId) {
      return { ok: false, statusCode: 403, message: 'Bạn chỉ có thể xoá bình luận của chính mình.' }
    }
  }

  /**
   * Delete and audit in ONE transaction.
   *
   * Written as delete-then-log at first, which loses the pair the moment the
   * second statement fails: the comment is gone and nothing records who removed
   * it. On a government portal that is the exact loss the audit log exists to
   * prevent — a public statement disappears and the trail says it never happened.
   * The reverse order is no better (a log claiming a deletion that did not occur),
   * so the only correct answer is both or neither, which is what `banReader` and
   * `deleteReader` already do.
   */
  await db.transaction(async (tx) => {
    await tx.delete(articleComments).where(eq(articleComments.id, params.id))

    // A reader deleting their own comment writes no admin audit row: the actor is
    // a member of the public, `activityLogs.userId` is a FK to `users`, and there
    // is no officer to attribute it to.
    if (params.actor.kind === 'admin') {
      await tx.insert(activityLogs).values({
        userId:     params.actor.userId,
        action:     'delete',
        resource:   'article_comments',
        resourceId: params.id,
        meta:       { articleId: row.articleId, wasReply: row.parentId !== null },
      })
    }
  })

  return { ok: true, deleted: 1 }
}

/**
 * What a deletion is about to remove, in three separate numbers.
 *
 * `otherReaderReplies` exists because nothing restricts WHO may reply: reader B
 * can answer reader A's question. Deleting A therefore takes B's reply with it
 * through the parent_id cascade — and an earlier version of this counter only
 * reported `comments` + `adminReplies`, so a dialog could say "2" while four rows
 * disappeared. The whole reason this shape is returned instead of one total is
 * that an officer has to see what else goes; undercounting defeats that.
 */
export type ReaderCommentImpact = {
  /** Rows this reader authored (top-level comments and their own replies). */
  comments: number
  /** Administrator replies sitting under this reader's top-level comments. */
  adminReplies: number
  /** Replies by OTHER readers under this reader's top-level comments. */
  otherReaderReplies: number
}

async function countImpact(readerId: number): Promise<{ impact: ReaderCommentImpact, topLevelIds: number[] }> {
  const db = getDb()

  const owned = await db
    .select({ id: articleComments.id, parentId: articleComments.parentId })
    .from(articleComments)
    .where(eq(articleComments.readerId, readerId))

  const topLevelIds = owned.filter(row => row.parentId === null).map(row => row.id)

  let adminReplies = 0
  let otherReaderReplies = 0
  if (topLevelIds.length) {
    // Everything hanging off this reader's top-level comments, split by author.
    // Counted in one pass rather than two queries so the two numbers cannot be
    // read from different moments.
    const rows = await db
      .select({ id: articleComments.id, adminUserId: articleComments.adminUserId, readerId: articleComments.readerId })
      .from(articleComments)
      .where(inArray(articleComments.parentId, topLevelIds))

    for (const row of rows) {
      if (row.adminUserId !== null) adminReplies += 1
      // A reply authored by somebody else. `readerId === readerId` would be this
      // reader's own reply, which is already inside `owned`.
      else if (row.readerId !== readerId) otherReaderReplies += 1
    }
  }

  return { impact: { comments: owned.length, adminReplies, otherReaderReplies }, topLevelIds }
}

/**
 * What a ban or an account deletion is about to remove, measured *before*
 * anything is removed.
 *
 * The confirmation dialog has to name the administrator replies too: those are
 * the portal's own published answers, and they disappear with the questions they
 * sit under. An officer who is only told "3 bình luận" is agreeing to something
 * different from what happens.
 */
export async function countReaderCommentImpact(readerId: number): Promise<ReaderCommentImpact> {
  return (await countImpact(readerId)).impact
}

/**
 * Removes every comment a reader wrote, and the administrator replies beneath
 * their top-level comments (design.md D8 — the `parentId` cascade).
 *
 * Returns the counts measured before the delete, because after it there is
 * nothing left to count and a successful purge would be indistinguishable from
 * one that never ran.
 */
/**
 * `executor` lets a caller run this inside a transaction it already opened, so a
 * deletion and the audit row describing it commit together. Defaults to the pool
 * for callers that own no transaction. Typed structurally rather than importing
 * Drizzle's transaction type, which is not exported in a usable shape here.
 */
type CommentDeleteExecutor = Pick<ReturnType<typeof getDb>, 'delete'>

export async function deleteReaderComments(readerId: number, executor?: CommentDeleteExecutor): Promise<ReaderCommentImpact> {
  const { impact } = await countImpact(readerId)
  if (impact.comments === 0) return impact

  // One statement: the FK cascade on parentId removes the replies, including the
  // administrator ones. Deleting replies separately first would leave a window
  // where a reply is gone but its question is still on the page.
  await (executor ?? getDb()).delete(articleComments).where(eq(articleComments.readerId, readerId))
  return impact
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
 */
export async function loadCommentThread(params: {
  articleId:       number
  page:            number
  perPage:         number
  viewerReaderId:  number | null
}): Promise<ThreadPage> {
  const db = getDb()
  const { articleId, perPage, viewerReaderId } = params

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(articleComments)
    .where(and(eq(articleComments.articleId, articleId), isNull(articleComments.parentId)))

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
  }

  const topRows = await db
    .select(selection)
    .from(articleComments)
    .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
    .where(and(eq(articleComments.articleId, articleId), isNull(articleComments.parentId)))
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
    const replyRows = await db
      .select(selection)
      .from(articleComments)
      .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
      .where(inArray(articleComments.parentId, parents.map(parent => parent.id)))
      .orderBy(articleComments.createdAt, articleComments.id)

    for (const row of replyRows) {
      const parent = row.parentId === null ? undefined : byId.get(row.parentId)
      if (parent) parent.replies!.push(serializePublicComment(row, viewerReaderId))
    }
  }

  return { comments: parents, total, page, perPage, totalPages }
}

// ─── Moderation side ─────────────────────────────────────────────────────────

export type AdminCommentRow = {
  id:           number
  body:         string
  createdAt:    Date | null
  parentId:     number | null
  articleId:    number
  articleTitle: string | null
  articleSlug:  string | null
  readerId:     number | null
  readerName:   string | null
  /** The raw Google column, kept on the row so /admin/readers/[id] can show what
   *  the account was originally called next to the chosen name. */
  readerCustomName: string | null
  readerEmail:  string | null
  adminUserId:  number | null
  adminName:    string | null
  ip:           string | null
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
 */
export async function listCommentsForAdmin(params: {
  articleId: number | null
  page:      number
  perPage:   number
}): Promise<AdminCommentList> {
  const db = getDb()
  const where = params.articleId === null ? undefined : eq(articleComments.articleId, params.articleId)

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
      readerId:     articleComments.readerId,
      readerName:       readerAccounts.displayName,
      readerCustomName: readerAccounts.customDisplayName,
      readerEmail:  readerAccounts.email,
      adminUserId:  articleComments.adminUserId,
      adminName:    users.username,
      ip:           articleComments.ip,
    })
    .from(articleComments)
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
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
        : effectiveDisplayName({ customDisplayName: row.readerCustomName, displayName: row.readerName }),
    })),
    total,
    page,
    perPage,
    totalPages,
  }
}

export type AdminReplyResult =
  | { ok: true, id: number }
  | { ok: false, statusCode: number, message: string }

/**
 * The portal replying in public, under the fixed "Ban quản trị" label.
 *
 * Two rules that differ from a reader's write, both deliberate:
 *
 *   1. **Allowed on a closed thread.** Closing comments stops the public from
 *      posting, not the portal from answering. An officer who closes a thread to
 *      stop an argument still has to be able to post the correct information
 *      under it.
 *   2. **No rate limit.** The limits exist to bound anonymous public writes; an
 *      authenticated officer is already accountable through the audit row.
 *
 * The one-level rule still holds, through the same pure `checkParentEligibility`
 * the reader path uses — an official reply nested under another reply would break
 * the two-pass read and render nowhere.
 */
export async function createAdminReply(params: {
  parentId: number
  body:     string
  actorId:  number
  ip:       string | null
  userAgent: string | null
}): Promise<AdminReplyResult> {
  const db = getDb()

  const [parent] = await db
    .select({
      id:        articleComments.id,
      articleId: articleComments.articleId,
      parentId:  articleComments.parentId,
    })
    .from(articleComments)
    .where(eq(articleComments.id, params.parentId))
    .limit(1)

  if (!parent) return { ok: false, statusCode: 404, message: 'Bình luận gốc không tồn tại.' }

  const verdict = checkParentEligibility(parent, parent.articleId)
  if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.message }

  // Reply and audit row commit together: a reply that exists with no logged
  // record of which admin posted it is the same unaccountable gap this file's
  // deleteComment guards against, just on the write side instead of the delete side.
  let id = 0
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(articleComments).values({
      articleId:   parent.articleId,
      readerId:    null,
      adminUserId: params.actorId,
      parentId:    parent.id,
      body:        params.body,
      ip:          params.ip,
      userAgent:   (params.userAgent || '').slice(0, 512) || null,
      // Drizzle query builder, never pool.query — design.md D17.
      createdAt:   new Date(),
    })

    // Destructured for the reason above — and here the cost of getting it wrong is
    // the concrete one: `resourceId: 0` on the audit row below, an official reply
    // in force whose audit entry points at no row. Exactly what wrapping these two
    // writes in a transaction exists to prevent.
    const [header] = inserted
    id = Number(header?.insertId ?? 0)

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'create',
      resource:   'comments',
      resourceId: id,
      meta:       { operation: 'admin_reply', articleId: parent.articleId, parentId: parent.id },
    })
  })

  return { ok: true, id }
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
