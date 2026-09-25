/**
 * Vá URL ảnh hỏng hàng loạt trong `media.url` + `articles.content`.
 *
 * Ca anh đang gặp (all bài): sync đã chạy (Local 0 / R2 3212) nhưng rewrite hỏng
 * nên mọi bài vẫn `<img src="http://localhost:3000/uploads/migrated/media/*.jpeg">`
 * trong khi file local đã bị xoá. Kèm theo `media.url` thiếu scheme
 * (`cdn1.delify.vn/...`) → grid thành `http://localhost:3000/cdn1...`.
 *
 * Idempotent, < vài giây, tự backup SQL trước. Không tải file — chỉ UPDATE chuỗi.
 */
import { eq, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, articles, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'

const LOCK_NAME = 'cdkt:media:repair-urls'

export interface RepairResult {
  mediaFixed: number
  articlesFixed: number
  backupStamp: string | null
}

export async function repairMediaUrls(adminUserId: number | null): Promise<RepairResult> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const outcome = await withNamedLock(pool, LOCK_NAME, 0, async () => {
    let backupStamp: string | null = null
    try {
      const r = await runBackup('sql', 'pre-repair-urls', adminUserId)
      backupStamp = r.stamp
    } catch (err) {
      logWarn({ event: 'media.repair_pre_backup_failed', error: err instanceof Error ? err.message : String(err) })
    }

    let mediaFixed = 0
    let articlesFixed = 0

    await db.transaction(async (tx) => {
      // ── 1. Vá `media.url` ─────────────────────────────────────────────
      // 1a. Double-prefix do REPLACE naive trước đó:
      //     `http://localhost:3000/cdn1.delify.vn/...` hoặc `http://localhost:3000https://cdn1...`
      {
        const [r1] = await tx.execute(sql`UPDATE media SET url = REPLACE(url, 'http://localhost:3000/', '') WHERE url LIKE 'http://localhost:3000/cdn1%'`)
        mediaFixed += affectedRowsOrZero(r1)
        const [r2] = await tx.execute(sql`UPDATE media SET url = REPLACE(url, 'https://localhost:3000/', '') WHERE url LIKE 'https://localhost:3000/cdn1%'`)
        mediaFixed += affectedRowsOrZero(r2)
        const [r3] = await tx.execute(sql`UPDATE media SET url = REPLACE(url, 'http://localhost:3000', '') WHERE url LIKE 'http://localhost:3000http%'`)
        mediaFixed += affectedRowsOrZero(r3)
        const [r4] = await tx.execute(sql`UPDATE media SET url = REPLACE(url, 'https://localhost:3000', '') WHERE url LIKE 'https://localhost:3000http%'`)
        mediaFixed += affectedRowsOrZero(r4)
      }
      // 1b. Thiếu scheme: `cdn1.delify.vn/2026/09/...` → `https://cdn1.delify.vn/...`
      {
        const [r] = await tx.execute(sql`UPDATE media SET url = CONCAT('https://', url) WHERE url NOT LIKE 'http%' AND url LIKE 'cdn1.delify.vn%'`)
        mediaFixed += affectedRowsOrZero(r)
      }

      // ── 2. Vá `articles.content` ──────────────────────────────────────
      // 2a. Double-prefix trong content (nếu từng REPLACE naive)
      {
        const [r1] = await tx.execute(sql`UPDATE articles SET content = REPLACE(content, 'http://localhost:3000https://', 'https://') WHERE content LIKE '%http://localhost:3000https://%'`)
        articlesFixed += affectedRowsOrZero(r1)
        const [r2] = await tx.execute(sql`UPDATE articles SET content = REPLACE(content, 'https://localhost:3000https://', 'https://') WHERE content LIKE '%https://localhost:3000https://%'`)
        articlesFixed += affectedRowsOrZero(r2)
        const [r3] = await tx.execute(sql`UPDATE articles SET content = REPLACE(content, 'http://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn') WHERE content LIKE '%http://localhost:3000/cdn1.delify.vn%'`)
        articlesFixed += affectedRowsOrZero(r3)
        const [r4] = await tx.execute(sql`UPDATE articles SET content = REPLACE(content, 'https://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn') WHERE content LIKE '%https://localhost:3000/cdn1.delify.vn%'`)
        articlesFixed += affectedRowsOrZero(r4)
      }

      // 2b. Thay `/uploads/migrated/media/<filename>` (cả absolute lẫn relative)
      //     bằng `media.url` R2 đúng — đây là nhóm all bài đang hỏng.
      //     Lấy danh sách R2 trong transaction để đảm bảo url đã vá ở bước 1.
      const r2Media = await tx.select({ filename: media.filename, url: media.url }).from(media).where(eq(media.provider, 'r2'))
      for (const m of r2Media) {
        if (!m.filename || !m.url || m.filename.length < 5) continue
        const filenameEsc = m.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const oldRel = `/uploads/migrated/media/${m.filename}`
        const absPattern = `https?:\\/\\/[^"'\\s<>]*\\/uploads\\/[^"'\\s<>]*${filenameEsc}`
        try {
          const [absRes] = await tx.execute(
            sql`UPDATE articles SET content = REGEXP_REPLACE(content, ${absPattern}, ${m.url}) WHERE content REGEXP ${absPattern}`,
          )
          articlesFixed += affectedRowsOrZero(absRes)
        } catch {
          // MySQL < 8 → bỏ qua, sẽ thử REPLACE thường bên dưới
        }
        const [relRes] = await tx.execute(
          sql`UPDATE articles SET content = REPLACE(content, ${oldRel}, ${m.url}) WHERE content LIKE ${'%' + oldRel + '%'}`,
        )
        articlesFixed += affectedRowsOrZero(relRes)
      }

      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'repair_urls',
        resource: 'media',
        resourceId: null,
        meta: { mediaFixed, articlesFixed, backupStamp, r2Count: r2Media.length },
      })
    })

    return { mediaFixed, articlesFixed, backupStamp }
  })

  if (!outcome.acquired) throw new Error('Một lượt vá URL khác đang chạy. Thử lại sau.')

  const r = outcome.value
  logInfo({ event: 'media.repair_complete', ...r })
  return r
}
