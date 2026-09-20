/**
 * One page of a comment thread, by article **or** media slug.
 *
 * Called from the browser after mount, never during SSR — the article and media
 * routes are both SWR-cached (design.md constraint 1), and this response depends
 * on who is asking: `canDelete` differs per reader. A cached copy of it would
 * show one visitor delete buttons on another visitor's comments.
 *
 * An unknown slug, an unpublished item and a closed thread all return an empty
 * thread with `enabled: false` rather than a 404. The component renders nothing
 * in that case, and a status code that varied by slug would let this endpoint be
 * used to enumerate unpublished items.
 *
 * ## Which table the slug is looked up in comes from `?source=`
 *
 * Article slugs and media slugs are unique **within their own table** and nothing
 * stops the same string existing in both, so the slug alone cannot say which
 * thread is being asked for — guessing would read the wrong thread rather than
 * fail. `parseCommentSource` names the table, and an unrecognised value is
 * **refused** instead of falling back to articles: a silent fallback answers a
 * request for a video thread with an article's comments, and the page renders
 * plausibly while showing the wrong conversation.
 *
 * Absent `source` means articles — the request every existing article page sends
 * is unchanged byte for byte.
 */
import { finitePositive } from '../../../utils/query-number'
import { and, eq } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { articles, mediaItems } from '../../../db/schema'
import { optionalReader } from '../../../utils/reader-auth'
import { COMMENT_MAX_PER_PAGE, loadCommentThread, parseCommentSource, type PublicComment } from '../../../services/comments'
import { PUBLISHED_MEDIA_STATUS } from '../../../services/media-portal'
import { COMMENT_THREAD_PER_PAGE } from '../../../services/notifications'

/**
 * Small enough to keep the first paint quick, large enough that most threads fit
 * on one page.
 *
 * Imported rather than declared here: services/notifications.ts converts a
 * comment's position into the page number a notification link carries, and if
 * that arithmetic used a different page size from this endpoint, every deep link
 * would be off by the drift — landing readers near their comment instead of on
 * it, with nothing failing anywhere.
 */
const DEFAULT_PER_PAGE = COMMENT_THREAD_PER_PAGE

/**
 * A query number is finite or it is the default — never `Math.max(1, Number(x))`.
 *
 * `Number('abc')` is NaN, every comparison with NaN is false, so a clamp written
 * that way passes NaN straight through into `.offset()` and serialises as
 * `page: null`: the endpoint returns rows while claiming to be on no page at all.
 * `?page=1e999` (Infinity) gets through the same hole. This is the bug the
 * /qa-documents work already hit once; the check has to come BEFORE the clamp.
 */

/**
 * Hợp đồng của endpoint này — **một** hình dạng cho cả bốn nhánh `return`.
 *
 * Ba nhánh rỗng trước đây không mang `signedIn`, nên `$fetch` suy ra một union và
 * mọi phép đọc ở component phải tự thu hẹp trước. `enabled` đã đủ để phân biệt
 * luồng đóng với luồng mở, nên `signedIn` vắng mặt không nói thêm điều gì — nó chỉ
 * làm kiểu khó dùng hơn ở đúng chỗ cần dùng nó.
 *
 * `signedIn` ở nhánh rỗng là `false` **có nghĩa thật**, không phải giá trị lấp
 * chỗ: khi luồng bị đóng thì không ai đăng được, kể cả người đã đăng nhập.
 */
interface CommentThreadResponse {
  ok: boolean
  enabled: boolean
  signedIn: boolean
  comments: PublicComment[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

/**
 * Là **hàm**, không phải hằng dùng chung.
 *
 * `EMPTY` trước đây là một object ở cấp module, nên **cùng một mảng `comments`**
 * được phát đi cho mọi request có luồng đóng. Trải nó bằng `...EMPTY` copy tham
 * chiếu chứ không copy mảng, nên một lượt `.push()` ở bất cứ đâu phía sau sẽ rò
 * bình luận sang mọi phản hồi rỗng tiếp theo — trên đúng endpoint mà nội dung
 * phụ thuộc vào người đang hỏi.
 */
function emptyThread(page: number, perPage: number): CommentThreadResponse {
  return { ok: true, enabled: false, signedIn: false, comments: [], total: 0, page, perPage, totalPages: 1 }
}

export default defineEventHandler(async (event): Promise<CommentThreadResponse> => {
  const slug = getRouterParam(event, 'articleSlug')
  const query = getQuery(event)

  const page = finitePositive(query.page, 1, 100_000)
  const perPage = finitePositive(query.perPage, DEFAULT_PER_PAGE, COMMENT_MAX_PER_PAGE)

  // A value that is neither empty nor one of the two known kinds is refused, not
  // coerced. `?source=1` falling back to articles would answer a request for a
  // video thread with an article's comments — and the page would render, which is
  // what makes a silent fallback worse than an error.
  const parsed = parseCommentSource(query.source)
  if (!parsed.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Nguồn bình luận không hợp lệ.' })
  }

  if (!slug) return emptyThread(page, perPage)

  const isMedia = parsed.source === 'media'

  /**
   * The item **and its own `comments_enabled`**, read from the table the slug
   * belongs to.
   *
   * The flag is never shared between the two kinds: an article's
   * `comments_enabled` says nothing about a video, and reading the wrong one is
   * how a closed video would serve an open thread. The media branch imports the
   * published-status literal rather than spelling it here, so the definition of
   * "publicly visible" stays in one place.
   */
  let itemId: number
  let commentsEnabled: boolean

  if (isMedia) {
    const [row] = await getDb()
      .select({ id: mediaItems.id, commentsEnabled: mediaItems.commentsEnabled })
      .from(mediaItems)
      .where(and(eq(mediaItems.slug, slug), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
      .limit(1)
    if (!row) return emptyThread(page, perPage)
    itemId = row.id
    commentsEnabled = row.commentsEnabled
  } else {
    const [row] = await getDb()
      .select({ id: articles.id, commentsEnabled: articles.commentsEnabled })
      .from(articles)
      .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
      .limit(1)
    if (!row) return emptyThread(page, perPage)
    itemId = row.id
    commentsEnabled = row.commentsEnabled
  }

  // Turning comments off hides the thread; it never deletes it (design.md D10).
  // The rows are still there and administrators still see them in moderation.
  if (!commentsEnabled) return emptyThread(page, perPage)

  const reader = await optionalReader(event)
  const thread = await loadCommentThread({
    ...(isMedia ? { mediaItemId: itemId } : { articleId: itemId }),
    page,
    perPage,
    viewerReaderId: reader?.id ?? null,
  })

  return { ok: true, enabled: true, signedIn: reader !== null, ...thread }
})
