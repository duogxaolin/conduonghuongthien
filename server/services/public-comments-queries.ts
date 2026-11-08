/**
 * The slug → item lookups of the two public comment endpoints — the thread read
 * (`comments/[articleSlug].get.ts`) and the post (`comments/index.post.ts`, whose article
 * lookup is `findPublishedArticleIdBySlug` in `public-articles-queries.ts`) — moved out of the
 * handlers verbatim.
 *
 * The handlers keep choosing the table (`?source=` / which body field is present), the reader
 * session, every refusal, and the call into the comment service (`loadCommentThread`,
 * `createComment`), which takes an identifier and re-checks the item itself.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articles, mediaItems } from '../db/schema'
import { PUBLISHED_MEDIA_STATUS } from './media-portal'

/**
 * A published video and its OWN `comments_enabled`, by `short_id`, or undefined.
 *
 * Media giờ tra theo `short_id` (định danh URL công khai). Route param vẫn tên
 * `articleSlug` vì endpoint phục vụ cả hai loại; nhánh media dùng `short_id`.
 */
export async function findCommentThreadMedia(shortId: string) {
  const [row] = await getDb()
    .select({ id: mediaItems.id, commentsEnabled: mediaItems.commentsEnabled })
    .from(mediaItems)
    .where(and(eq(mediaItems.shortId, shortId), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)
  return row
}

/** A published article and its OWN `comments_enabled`, by slug, or undefined. */
export async function findCommentThreadArticle(slug: string) {
  const [row] = await getDb()
    .select({ id: articles.id, commentsEnabled: articles.commentsEnabled })
    .from(articles)
    .where(and(eq(articles.slug, slug), eq(articles.status, 'published')))
    .limit(1)
  return row
}

/**
 * The id of the published video a comment is posted on, by `short_id`, or undefined.
 *
 * Media tra theo `short_id` (định danh URL công khai). `mediaKey` từ body
 * là short_id mà frontend gửi; link cũ dùng slug đã redirect 301 ở trang chi tiết.
 */
export async function findPublishedMediaIdByShortId(mediaKey: string) {
  const [media] = await getDb()
    .select({ id: mediaItems.id })
    .from(mediaItems)
    .where(and(eq(mediaItems.shortId, mediaKey), eq(mediaItems.status, PUBLISHED_MEDIA_STATUS)))
    .limit(1)
  return media
}
