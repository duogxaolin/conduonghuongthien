import { and, eq, like, or, type SQL } from 'drizzle-orm'
import { media, mediaItems } from '../../db/schema'
import { containsPattern } from '../sql-like'

/**
 * Điều kiện lọc cho công cụ `search_c11_videos` / `search_c11_photos` của chatbot.
 *
 * Tách khỏi `chat-policy.ts` để kiểm được bằng cách biên dịch sang SQL (xem
 * `tests/security-chatbot-article-search.test.ts`): chuỗi do model truyền vào chỉ
 * đi vào tham số, và `%`/`_` trong đó không còn là ký tự đại diện.
 */

export function videoSearchCondition(query: string): SQL {
  const pattern = containsPattern(query)
  return and(
    eq(mediaItems.status, 'published'),
    or(like(mediaItems.title, pattern), like(mediaItems.description, pattern))!,
  )!
}

export function photoSearchCondition(query: string): SQL {
  const pattern = containsPattern(query)
  return and(
    like(media.mimeType, 'image/%'),
    or(like(media.originalName, pattern), like(media.filename, pattern))!,
  )!
}
