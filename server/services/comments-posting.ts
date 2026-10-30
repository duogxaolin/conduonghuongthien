/**
 * A reader posting a comment: the refusal gates, the two rate limits, the
 * instant pre-moderation, the insert + reply notification in one transaction,
 * and — after the commit — the full (AI) moderation and the reply e-mail.
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file. The e-mail's hold
 * policy lives in comments-reply-email.ts; the ordering it is applied in stays
 * here, in `createComment`.
 */

import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { getDb } from '../utils/db'
import { articleComments, articles, mediaItems, readerAccounts } from '../db/schema'
import { isIpBanned } from '../utils/ip-ban'
import { loadIpBanValues } from './ip-bans'
import { recordRateLimitHit, type RateLimitRule } from '../utils/rate-limit-store'
import { effectiveDisplayName } from '../utils/display-name'
import { createReplyNotification } from './notifications'
import { sendReplyEmail } from './notification-email'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { checkAndModerateContent, fastPreModerate, type ModerationCheckOutput } from './moderation-worker'
import { createModerationRegexBudget } from './moderation-regex'
import { logError } from '../utils/logger'
import { checkParentEligibility, resolveCommentTarget } from './comments-rules'
import { missingCommentTarget } from '../utils/fk-error'
import { withDeadlockRetry } from '../utils/deadlock-retry'
import { logReplyEmailHeld, MODERATION_FAILED, replyEmailHoldReason, type ModerationFailure } from './comments-reply-email'

/** Per reader. Window 1 phút — chặn spam nhanh thay vì khoá dài. */
const COMMENT_READER_RULE: RateLimitRule = { limit: 10, windowSeconds: 60 }

/** Per address. Lỏng hơn reader vì NAT/share IP. */
const COMMENT_IP_RULE: RateLimitRule = { limit: 25, windowSeconds: 60 }

async function loadIpBans(): Promise<string[]> {
  return loadIpBanValues()
}

export type CreateCommentInput = {
  readerId:  number
  /** Exactly one of `articleId` / `mediaItemId` is set. Enforced by
   *  `resolveCommentTarget` at the top of `createComment`, not by the type —
   *  both are optional so a caller that reads them from a request body does not
   *  have to cast, and the runtime check is what actually holds. */
  articleId?:    number
  mediaItemId?:  number
  parentId:  number | null
  body:      string
  ip:        string | null
  userAgent: string | null
  /** The request the comment was posted from — forwarded to sendReplyEmail so
   *  the link in the notification points at the domain the reader is using, not
   *  a fixed `PUBLIC_BASE_URL`. One codebase may serve several domains. */
  event:     H3Event
}

export type CreateCommentResult =
  | { ok: true, id: number }
  | { ok: false, statusCode: number, message: string, retryAfterSeconds?: number }

/**
 * Writes one comment, refusing in a fixed order.
 *
 * The order is the point. Every gate below is a reason the write must not
 * happen, and each is checked before **either** rate limit is charged — the two
 * `recordRateLimitHit` calls sit just before moderation and the insert. Charging earlier
 * would make a refusal cost allowance: a reader whose five attempts all landed
 * on a closed article, or all named a parent from another article, would be
 * locked out for ten minutes without a single comment existing. Worse, it hands
 * an attacker a way to exhaust someone else's allowance using requests that were
 * always going to fail. Allowance is spent on writes, not on refusals.
 *
 * The one refusal that comes AFTER the limits is the instant moderation block,
 * because it is not free: every blocked comment writes an `ai_moderation_queue`
 * row for officers to review. Checked first, it let a reader — or a script
 * holding many Google accounts — write review rows with no limit at all. So a
 * blocked comment spends allowance like a written one, and its review rows are
 * further capped per account and per address (`capQueuePerSource`).
 *
 * The item may be an article or a media item; `resolveCommentTarget` decides
 * which, and the two branches below are the same four checks against the table
 * that holds that kind. The article branch is byte-for-byte the behaviour it had
 * before media comments existed — same status codes, same messages — because it
 * is serving production rows and a change there would be a change to a working
 * feature rather than an extension of it.
 */
export async function createComment(input: CreateCommentInput): Promise<CreateCommentResult> {
  const db = getDb()

  const resolved = resolveCommentTarget(input.articleId, input.mediaItemId)
  if (!resolved.ok) return { ok: false, statusCode: 400, message: resolved.message }
  const target = resolved.target

  let contextTitle: string | null = null
  let contextUrl: string | null = null

  if (target.kind === 'article') {
    const [article] = await db
      .select({
        id:              articles.id,
        title:           articles.title,
        slug:            articles.slug,
        status:          articles.status,
        commentsEnabled: articles.commentsEnabled,
      })
      .from(articles)
      .where(eq(articles.id, target.articleId))
      .limit(1)

    if (!article || article.status !== 'published') {
      return { ok: false, statusCode: 404, message: 'Bài viết không tồn tại.' }
    }
    if (!article.commentsEnabled) {
      return { ok: false, statusCode: 403, message: 'Bài viết này hiện không mở bình luận.' }
    }
    contextTitle = `Bài viết: ${article.title}`
    contextUrl = `/news/${article.slug}`
  } else {
    const [item] = await db
      .select({
        id:              mediaItems.id,
        title:           mediaItems.title,
        slug:            mediaItems.slug,
        shortId:         mediaItems.shortId,
        status:          mediaItems.status,
        commentsEnabled: mediaItems.commentsEnabled,
      })
      .from(mediaItems)
      .where(eq(mediaItems.id, target.mediaItemId))
      .limit(1)

    if (!item || item.status !== 'published') {
      return { ok: false, statusCode: 404, message: 'Video không tồn tại.' }
    }
    if (!item.commentsEnabled) {
      return { ok: false, statusCode: 403, message: 'Video này hiện không mở bình luận.' }
    }
    contextTitle = `Video: ${item.title}`
    contextUrl = `/media/${item.shortId || item.slug}`
  }

  const [reader] = await db
    .select({
      id: readerAccounts.id,
      isBanned: readerAccounts.isBanned,
      displayName: readerAccounts.displayName,
      customDisplayName: readerAccounts.customDisplayName,
      displayNameReserved: readerAccounts.displayNameReserved,
    })
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
        id:          articleComments.id,
        articleId:   articleComments.articleId,
        mediaItemId: articleComments.mediaItemId,
        parentId:    articleComments.parentId,
      })
      .from(articleComments)
      .where(eq(articleComments.id, input.parentId))
      .limit(1)

    const verdict = checkParentEligibility(parent ?? null, target)
    if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.message }
  }

  // ── Everything above was a reason to refuse. Only now is allowance spent. ──
  const deps = rateLimitDeps()
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

  // ── Kiểm duyệt tức thì (< 1ms): chặn ngay từ ngữ thô tục, chống phá, cờ bạc ──
  // AFTER the limits: a block writes a review row (see the function comment).
  // The row cap is per account AND per address — MODERATION_QUEUE_CAP. One regex
  // budget for this comment: this check AND the full moderation below (which runs on
  // the same event loop after the response) together match for at most its limit.
  const regexBudget = createModerationRegexBudget()
  const preCheck = await fastPreModerate(input.body, {
    authorName: (reader ? effectiveDisplayName(reader) : null) || 'Người đọc',
    authorIp: input.ip ?? undefined,
    readerId: input.readerId,
    targetType: 'comment',
    contextTitle: contextTitle || undefined,
    contextUrl: contextUrl || undefined,
    capQueuePerSource: true,
    regexBudget,
  })
  if (preCheck.blocked) {
    // Never `reason`: it names the rule (pattern, keyword) — the review row keeps it for admins.
    return { ok: false, statusCode: 400, message: preCheck.publicMessage }
  }

  /**
   * Comment and notification commit together.
   *
   * The reply and the notice that it happened are one fact, not two. Written as
   * insert-then-notify, a failure on the second statement leaves a reply on the
   * page that its author is never told about — which is the exact state this
   * feature exists to prevent, and it fails silently: the thread looks correct to
   * everyone except the one person waiting for an answer.
   *
   * A deadlock victim (a reply holds comment → reader; a ban or account deletion holds
   * reader → comment) is run again whole, outside the rolled-back transaction: the limits and
   * the instant check ran once above, moderation and e-mail run once below, nothing in the
   * transaction acts outside it. Its values are returned, never left in outer variables.
   */
  const written = await withDeadlockRetry(() => db.transaction(async (tx) => {
    const inserted = await tx.insert(articleComments).values({
      articleId:   target.kind === 'article' ? target.articleId : null,
      mediaItemId: target.kind === 'media' ? target.mediaItemId : null,
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
    const id = Number(header?.insertId ?? 0)

    // No-op for a top-level comment, and for a reader answering themselves.
    const notifiedReaderId = await createReplyNotification({
      commentId:     id,
      parentId:      input.parentId,
      actorReaderId: input.readerId,
      tx,
    })
    return { id, notifiedReaderId }
  })).then(row => row, (error: unknown) => {
    // What the comment hangs on went (a ban or purge took the parent, the article or video was
    // deleted) between the checks above and the insert: the checks' own answer, not a 500. Only
    // those keys (utils/fk-error.ts) — the author's own row, say, is not "the thing replied to".
    const gone = missingCommentTarget(error)
    if (gone) return gone
    throw error
  })
  if (written === 'parent') return { ok: false, statusCode: 400, message: 'Bình luận gốc không tồn tại.' }
  if (written === 'article') return { ok: false, statusCode: 404, message: 'Bài viết không tồn tại.' }
  if (written === 'media') return { ok: false, statusCode: 404, message: 'Video không tồn tại.' }
  const { id, notifiedReaderId } = written

  if (id <= 0) return { ok: true, id }

  // Full (AI) moderation, started once for every comment, after the commit and
  // never awaited by this request. `.catch` so a moderation failure is a logged
  // outcome, never an unhandled rejection on a promise nobody else awaits.
  const moderation: Promise<ModerationCheckOutput | ModerationFailure> = checkAndModerateContent({
    content: input.body,
    targetType: 'comment',
    targetId: id,
    authorName: (reader ? effectiveDisplayName(reader) : null) || 'Người đọc',
    authorIp: input.ip ?? undefined,
    contextTitle: contextTitle || undefined,
    contextUrl: contextUrl || undefined,
  }, { regexBudget }).catch((error: unknown) => {
    logError({ event: 'comment.moderation_failed', commentId: id, error })
    return MODERATION_FAILED
  })

  /**
   * The reply e-mail goes out only AFTER moderation has passed the reply (spec
   * comment-notifications, design D6) — and after the transaction, never inside
   * it (an unreachable SMTP host would hold this comment's row locks open for a
   * network timeout).
   *
   * Mailing first, as this did, delivered every reply moderation hid a second
   * later — abuse, scam links — into a citizen's inbox. Now: hidden or blocked →
   * no e-mail; moderation threw, or reported that the AI never judged the reply
   * (`aiFailed` — which is also how the gateway's own ~35 s request timeout
   * surfaces) → no e-mail, logged as `comment.reply_email_held`. Held is final:
   * there is no outbox to retry from (design D6 rejected one for now), and the
   * in-portal notification already told the reader.
   *
   * No timer of our own: D6 bounds moderation by its EXISTING timeout (the AI
   * gateway's). A shorter one on top only dropped the e-mail of clean replies
   * the model judged in 10–35 s.
   *
   * "Only the e-mail waits" (D6): the chain runs BEHIND the response, so the
   * reader's POST returns as soon as the reply is stored. It is registered with
   * Nitro's `event.waitUntil`, which keeps it tracked past the handler's return,
   * and it never rejects — everything is caught and logged.
   */
  if (notifiedReaderId !== null && input.parentId !== null) {
    const reply = { commentId: id, parentId: input.parentId, recipientId: notifiedReaderId, event: input.event }
    const chain = (async () => {
      try {
        const verdict = await moderation
        const hold = replyEmailHoldReason(verdict)
        if (hold === null) await sendReplyEmail(reply)
        else logReplyEmailHeld(reply, hold, verdict)
      } catch (error) {
        logError({ event: 'comment.reply_email_failed', commentId: id, error })
      }
    })()
    input.event.waitUntil?.(chain)
  }

  return { ok: true, id }
}
