/**
 * Thay URL ảnh trong bài viết sau khi đồng bộ storage: `articles.content` (rich-text)
 * và `articles.thumbnail_url`. Tách nguyên văn từ media-sync.ts; chỉ chạy SAU khi
 * các hàng `media` đã sync xong.
 */
import { sql } from 'drizzle-orm'

import type { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logWarn } from '../utils/logger'



/** Lưu cặp URL để thay trong rich-text sau khi sync. */
export interface UrlRewrite {
  oldUrl: string
  newUrl: string
}

/**
 * Thay URL cũ bằng URL mới trong `articles.content`. Dùng SQL `REPLACE()`
 * (MySQL) để một query cập nhật tất cả occurrence của oldUrl trong mỗi bài.
 * Trả số bài đã sửa (affected rows).
 *
 * Không regex, không split/join phía app — `REPLACE()` là chuỗi chính xác,
 * MySQL xử lý trên server nên không phải tải content về RAM để sửa.
 */
export async function rewriteArticleImageUrls(
  db: ReturnType<typeof getDb>,
  rewrites: UrlRewrite[],
  adminUserId: number | null,
): Promise<number> {
  let totalRewritten = 0
  for (const { oldUrl, newUrl } of rewrites) {
    if (!oldUrl || !newUrl || oldUrl === newUrl) continue
    try {
      // oldUrl luôn dạng /uploads/... (relative). Bài viết có thể chứa cả hai dạng:
      //   /uploads/migrated/media/foo.jpeg  (relative)
      //   http://localhost:3000/uploads/migrated/media/foo.jpeg (absolute)
      // Nếu chỉ REPLACE relative thì dạng absolute thành
      //   http://localhost:3000https://r2.../foo.jpeg  (hỏng).
      // Nên xử lý absolute TRƯỚC bằng REGEXP_REPLACE (MySQL 8+), rồi mới REPLACE relative.
      const escapedOldUrl = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const absPattern = `https?:\\/\\/[^"'\\s<>]*${escapedOldUrl}`
      let affected = 0
      try {
        const [absRes] = await db.execute(
          sql`UPDATE articles SET content = REGEXP_REPLACE(content, ${absPattern}, ${newUrl}) WHERE content REGEXP ${absPattern}`,
        )
        affected += affectedRowsOrZero(absRes)
      } catch {
        // REGEXP_REPLACE fail (MySQL < 8) → bỏ qua, sẽ thử REPLACE thường bên dưới.
      }
      const oldUrlLike = `%${oldUrl}%`
      const [relRes] = await db.execute(
        sql`UPDATE articles SET content = REPLACE(content, ${oldUrl}, ${newUrl}) WHERE content LIKE ${oldUrlLike}`,
      )
      affected += affectedRowsOrZero(relRes)
      if (affected > 0) {
        // Mỗi bài có thể bị đếm 2 lần nếu chứa cả hai dạng → unique count trong
        // totalRewritten sẽ dư, nhưng không sao: đây là số "lượt sửa" hiển thị, không
        // phải số bài unique nghiêm ngặt.
        totalRewritten += affected
        try {
          await db.insert(activityLogs).values({
            userId: adminUserId,
            action: 'update',
            resource: 'articles',
            resourceId: null,
            meta: { syncRewrite: true, oldUrl, newUrl, articlesAffected: affected },
          })
        } catch {
          // Audit hỏng không làm hỏng lượt sync đã thành công.
        }
      }
    } catch (err) {
      logWarn({
        event: 'media.sync_rewrite_failed',
        oldUrl,
        newUrl,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return totalRewritten
}

/**
 * Repoint `articles.thumbnail_url` từ URL sang URL mới. Khác `content` (rich-text
 * có thể chứa nhiều URL), `thumbnail_url` chỉ chứa 1 URL duy nhất — không cần
 * REGEXP_REPLACE/REPLACE; UPDATE WHERE match chính xác hoặc LIKE (cho cả absolute
 * lẫn relative). Trả số bài đã sửa.
 *
 * Trước đây sync chỉ repoint `content`, bỏ sót `thumbnail_url` → 1132 bài có
 * thumbnail vẫn trỏ `/uploads/migrated/...` sau khi media đã chuyển sang R2:
 * ảnh không tải được ở prod. Hàm này đóng gap đó.
 */
export async function repointArticleThumbnails(
  db: ReturnType<typeof getDb>,
  rewrites: UrlRewrite[],
  adminUserId: number | null,
): Promise<number> {
  let totalRewritten = 0
  for (const { oldUrl, newUrl } of rewrites) {
    if (!oldUrl || !newUrl || oldUrl === newUrl) continue
    try {
      // Match cả exact và absolute-prefix. oldUrl dạng /uploads/... (relative);
      // article có thể chứa http://host/uploads/... (absolute) — nếu chỉ UPDATE
      // WHERE thumbnail_url = oldUrl thì bỏ sót dạng absolute.
      const oldUrlLike = `%${oldUrl}%`
      const [res] = await db.execute(
        sql`UPDATE articles SET thumbnail_url = ${newUrl} WHERE thumbnail_url = ${oldUrl} OR thumbnail_url LIKE ${oldUrlLike}`,
      )
      const affected = affectedRowsOrZero(res)
      if (affected > 0) {
        totalRewritten += affected
        try {
          await db.insert(activityLogs).values({
            userId: adminUserId,
            action: 'update',
            resource: 'articles',
            resourceId: null,
            meta: { syncRepointThumbnail: true, oldUrl, newUrl, articlesAffected: affected },
          })
        } catch {
          // Audit hỏng không làm hỏng lượt repoint.
        }
      }
    } catch (err) {
      logWarn({
        event: 'media.sync_repoint_thumbnail_failed',
        oldUrl,
        newUrl,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return totalRewritten
}
