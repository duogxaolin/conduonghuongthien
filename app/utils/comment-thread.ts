/**
 * Pure helpers of the public comment thread — `components/ArticleComments.vue` and its parts
 * in `components/comments/` (split in wave3 4.2). No Vue, no network: what the thread
 * decides from a string or an array, kept where a test can reach it without a page.
 *
 * Relative imports only in the files this one is imported from (`composables/useComment*`):
 * they also run under Node in the tests, where Nuxt's `~/` alias does not exist.
 */
import type { PublicCommentItem } from '~/types/public-api'

/** Mirrors COMMENT_MAX_LENGTH on the server. The server is the authority; this
 *  only stops the reader typing past a limit the write would then refuse. */
export const COMMENT_MAX_LENGTH = 2000

/**
 * Id bình luận nêu trong `#comment-<id>`.
 *
 * Cùng cách đọc mà /qa-documents dùng cho `#qa-<id>`: `Number.isSafeInteger`
 * chứ không chỉ `Number`, nếu không một hash rác sẽ thành `NaN` rồi đi tiếp vào
 * `getElementById` như chuỗi "NaN".
 */
export function anchoredCommentId(hash: string | null | undefined): number | null {
  const raw = Number(String(hash || '').replace('#comment-', ''))
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null
}

/**
 * Trang bình luận nêu trong `?comments=<n>` — cùng cách đọc số như máy chủ:
 * `Number.isSafeInteger` chứ không phải `Math.max(1, Number(...))`. Không hợp lệ → `null`
 * (giữ trang hiện tại).
 */
export function requestedCommentsPage(value: unknown): number | null {
  const requested = Number(value)
  return Number.isSafeInteger(requested) && requested > 0 ? requested : null
}

/** Is this id on the page — as a top-level comment or as a reply? */
export function threadHasComment(comments: readonly PublicCommentItem[], id: number): boolean {
  return comments.some(c => c.id === id) || comments.some(c => c.replies?.some(r => r.id === id))
}

/**
 * Take a comment off the page, in place: a top-level comment (`'top'` — the thread count
 * drops with it) or a reply inside its parent (`'reply'` — replies are not in the count).
 * `null` when it is not on this page any more.
 */
export function removeCommentFromThread(comments: PublicCommentItem[], id: number): 'top' | 'reply' | null {
  const topIdx = comments.findIndex(c => c.id === id)
  if (topIdx !== -1) {
    comments.splice(topIdx, 1)
    return 'top'
  }
  for (const c of comments) {
    if (c.replies) {
      const rIdx = c.replies.findIndex(r => r.id === id)
      if (rIdx !== -1) {
        c.replies.splice(rIdx, 1)
        return 'reply'
      }
    }
  }
  return null
}

/**
 * Khoá `sessionStorage` của nháp — theo LOẠI và slug.
 *
 * Slug bài viết và slug video là hai không gian tên riêng (hai bảng), cùng một chuỗi có thể
 * tồn tại ở cả hai. Khoá chỉ theo slug (`cdkt:comment-draft:<slug>`, trước wave3 4.2) để nháp
 * của một video hiện lại trong khung soạn của bài viết trùng slug (FINDING-C4). Khoá của
 * bài viết giữ nguyên chữ cũ; video thêm `media:`.
 */
export function commentDraftKey(slug: string, isMedia: boolean): string {
  return isMedia ? `cdkt:comment-draft:media:${slug}` : `cdkt:comment-draft:${slug}`
}
