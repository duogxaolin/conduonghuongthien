/**
 * Đếm lượt xem video cổng media — tách khỏi `media-portal.ts` vì đây là một
 * domain nhỏ, thuần về bộ đếm: chỉ `mediaItems.viewCount + 1` kèm khử trùng 10
 * phút. Không chia sẻ state với đường đọc/ghi/Stream, không cần transaction.
 */
import { eq, sql } from 'drizzle-orm'

import { mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import {
  MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH,
  MEDIA_VIEW_DEDUPE_TOKEN_LENGTH,
} from './media-portal-constants'

export function buildMediaViewDedupeKey(mediaItemId: number, visitorToken: string): string {
  const key = `mv:${mediaItemId}:${visitorToken.slice(0, MEDIA_VIEW_DEDUPE_TOKEN_LENGTH)}`
  if (key.length > MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH) {
    throw new Error(`media view dedupe key exceeds ${MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH} characters`)
  }
  return key
}

/**
 * Một lượt xem. Một câu lệnh, không transaction: đây là bộ đếm của cổng về nội
 * dung của chính nó, không kèm dòng audit nào (người xem là khách công khai, và
 * `activity_logs.user_id` là FK tới `users` — không có hàng nào để trỏ vào).
 */
export async function recordMediaView(
  mediaItemId: number,
  executor?: Pick<Database, 'update'>,
): Promise<void> {
  await (executor ?? getDb())
    .update(mediaItems)
    .set({ viewCount: sql`${mediaItems.viewCount} + 1` })
    .where(eq(mediaItems.id, mediaItemId))
}
