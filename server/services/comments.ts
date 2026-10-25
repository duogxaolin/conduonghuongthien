/**
 * Public comments — validation, the write path, and every deletion path.
 *
 * This file is the comment service's public entry point: a barrel that
 * re-exports the same names it always exported, so every caller keeps one
 * import path. The code lives in sub-files, one per seam (wave2 D-SPLIT):
 *
 *   - comments-rules.ts       pure rules: body validation, the article/media
 *                             XOR target, the one-level reply rule, `?source=`
 *   - comments-thread.ts      the public projection and the two-pass thread read
 *   - comments-posting.ts     a reader posting: refusal gates, rate limits,
 *                             pre-moderation, insert + notification, and the
 *                             after-commit moderation → reply e-mail ordering
 *   - comments-reply-email.ts the reply e-mail's hold policy (not re-exported)
 *   - comments-deletion.ts    the single deletion path and the impact counts
 *   - comments-moderation.ts  the officer's moderation list and its read audit
 *   - comments-admin-reply.ts the portal's official reply
 *
 * Sub-files import each other, never this barrel.
 *
 * Three decisions from design.md (reader-google-login-comments) are load-bearing
 * across those files and each one is easy to undo by accident:
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
 * There is deliberately **no update path**: nothing in the comment service, and
 * no endpoint anywhere, accepts a new body for an existing comment. A public
 * comment that can be rewritten after the fact is a record of nothing — a reply
 * from the portal could end up sitting under a question that no longer resembles
 * the one it answered. Correcting a comment means deleting it and posting again,
 * which leaves the thread honest about what happened.
 */

export {
  COMMENT_MAX_LENGTH,
  validateBody,
  resolveCommentTarget,
  checkParentEligibility,
  parseCommentSource,
} from './comments-rules'
export type {
  BodyValidation,
  ParentCandidate,
  CommentTarget,
  CommentTargetResolution,
  ParentCheck,
  CommentSource,
} from './comments-rules'

export {
  ADMIN_REPLY_DISPLAY_NAME,
  initialsFrom,
  serializePublicComment,
  COMMENT_MAX_PER_PAGE,
  loadCommentThread,
} from './comments-thread'
export type { CommentRow, PublicComment, ThreadPage } from './comments-thread'

export { createComment } from './comments-posting'
export type { CreateCommentInput, CreateCommentResult } from './comments-posting'

export { deleteComment, countReaderCommentImpact, deleteReaderComments } from './comments-deletion'
export type { DeleteActor, DeleteCommentResult, ReaderCommentImpact } from './comments-deletion'

export { listCommentsForAdmin, auditCommentRead } from './comments-moderation'
export type { AdminCommentRow, AdminCommentList } from './comments-moderation'

export { createAdminReply } from './comments-admin-reply'
export type { AdminReplyResult } from './comments-admin-reply'
