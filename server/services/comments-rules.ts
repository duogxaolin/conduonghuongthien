/**
 * Comment rules that need no database — body validation, the article/media XOR
 * target, the one-level reply rule and the moderation screen's `?source=` filter.
 *
 * Part of the comment service; `comments.ts` is its public entry point (a barrel)
 * and carries the decisions that hold across every sub-file. Two of them live
 * here: a body is PLAIN TEXT and is never sanitised (`validateBody` bounds it and
 * refuses control characters instead), and there is exactly one reply level
 * (`checkParentEligibility`).
 */

// Phép kiểm ký tự điều khiển dùng chung với ghi chú xử lý đơn đăng ký
// (`submission-workflow.ts`). Một danh sách chặn tồn tại hai bản là hai chỗ để
// làm sai, và hai bản chỉ được đối chiếu khi một trong hai ngừng chặn — tức là
// sau khi việc đã xảy ra. Xem server/utils/plain-text.ts.
import { hasForbiddenControlChars } from '../utils/plain-text'

/** Long enough for a real question, short enough that one row cannot dominate a page. */
export const COMMENT_MAX_LENGTH = 2000

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

  if (hasForbiddenControlChars(normalized)) {
    return { ok: false, message: 'Nội dung bình luận chứa ký tự không được phép.' }
  }

  if (normalized.length > COMMENT_MAX_LENGTH) {
    return { ok: false, message: `Nội dung bình luận quá dài (tối đa ${COMMENT_MAX_LENGTH} ký tự).` }
  }

  return { ok: true, body: normalized }
}

export type ParentCandidate = {
  id:          number
  /** Null for a media comment — a comment belongs to an article OR a media item. */
  articleId:   number | null
  /** The mirror of `articleId`. Exactly one of the two is non-null. */
  mediaItemId: number | null
  parentId:    number | null
}

/**
 * Which item a comment is being written on, as a **kind plus an identity**.
 *
 * The kind is not decoration. `articleId` and `mediaItemId` are separate
 * auto-increment sequences, so article 7 and media item 7 are different things
 * that share a number — an identifier alone cannot say which thread a comment
 * belongs to, and a comparison on the number alone would happily attach a reply
 * to the wrong kind of item whenever the numbers happened to coincide.
 *
 * The alternative considered and rejected (design.md §1) was a
 * `comment_threads` parent table with polymorphic children: it gets the same
 * guarantee at the cost of migrating every existing article comment into a new
 * shape. The XOR below gets it for the price of one runtime check.
 */
export type CommentTarget =
  | { kind: 'article', articleId:   number }
  | { kind: 'media',   mediaItemId: number }

export type CommentTargetResolution =
  | { ok: true, target: CommentTarget }
  | { ok: false, message: string }

/**
 * The runtime XOR guard: exactly one of the two identifiers, never both and
 * never neither.
 *
 * Pure, and separated from `createComment`, because this is the invariant the
 * whole media-comment design rests on and a rule that can only be exercised
 * against a live MySQL server is a rule nobody exercises. Every caller that
 * accepts an item identifier from outside runs through here.
 *
 * Both-set is rejected rather than resolved by precedence: picking one would
 * store the comment on an item the caller may not have meant, and the row would
 * then be a permanent record of a decision nobody made.
 */
export function resolveCommentTarget(
  articleId: number | null | undefined,
  mediaItemId: number | null | undefined,
): CommentTargetResolution {
  const hasArticle = typeof articleId === 'number' && Number.isFinite(articleId) && articleId > 0
  const hasMedia   = typeof mediaItemId === 'number' && Number.isFinite(mediaItemId) && mediaItemId > 0

  if (hasArticle && hasMedia) {
    return { ok: false, message: 'Bình luận chỉ thuộc một đối tượng: bài viết hoặc video.' }
  }
  if (!hasArticle && !hasMedia) {
    return { ok: false, message: 'Thiếu đối tượng để bình luận.' }
  }
  return hasArticle
    ? { ok: true, target: { kind: 'article', articleId: articleId as number } }
    : { ok: true, target: { kind: 'media', mediaItemId: mediaItemId as number } }
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
 *
 * `target` is the item the new comment is being written on. The parent must
 * match it on **both** axes — same kind and same identifier. Comparing only the
 * identifier is the bug this signature exists to prevent: `articleId` and
 * `mediaItemId` are independent sequences, so a check that reduced the target to
 * a bare number would let a reply cross between an article and a video that
 * happen to share an id.
 *
 * Before the media engine, `itemId` was a `number | null` and two nulls were the
 * article-shaped way of saying "both are media comments" — which never proved
 * they were on the *same* media item. That gap is closed here.
 */
export function checkParentEligibility(parent: ParentCandidate | null | undefined, target: CommentTarget): ParentCheck {
  if (!parent) return { ok: false, message: 'Bình luận gốc không tồn tại.' }

  const sameItem = target.kind === 'article'
    ? parent.articleId === target.articleId && parent.mediaItemId === null
    : parent.mediaItemId === target.mediaItemId && parent.articleId === null

  if (!sameItem) return { ok: false, message: 'Bình luận gốc không thuộc nội dung này.' }
  if (parent.parentId !== null) return { ok: false, message: 'Chỉ có thể trả lời bình luận gốc, không trả lời một phản hồi.' }
  return { ok: true }
}

/**
 * The `?source=` filter of the moderation screen, parsed rather than guessed.
 *
 * Returns `null` for "no filter" and `{ ok: false }` for a value that is neither
 * empty nor one of the two known kinds. Collapsing those two into `null` — the
 * shape a bare `=== 'media' ? … : …` ternary produces — means `?source=1`
 * silently returns everything while the screen still shows "Video" in the
 * filter, and the officer concludes there are no article comments left.
 */
export type CommentSource = 'article' | 'media'

export function parseCommentSource(raw: unknown): { ok: true, source: CommentSource | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, source: null }
  const value = String(raw).trim()
  if (value === '') return { ok: true, source: null }
  if (value === 'article' || value === 'media') return { ok: true, source: value }
  return { ok: false }
}
