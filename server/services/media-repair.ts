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

      // 2b. Thay `*/uploads/migrated/media/<file>` (cả absolute lẫn relative) bằng
      //     `media.url` R2 đúng — in-memory: đọc mỗi article một lần, thay bằng regex
      //     JS, ghi lại 1 câu UPDATE per article. Trước đây lặp từng filename ×
      //     (REGEXP_REPLACE scan cả cột LONGTEXT + REPLACE scan lại) = ~1920 quét full
      //     bảng, treo >95s với 960 file; migration khởi động phải < vài giây.
      const r2Media = await tx.select({ filename: media.filename, url: media.url }).from(media).where(eq(media.provider, 'r2'))
      const urlByFilename = new Map<string, string>()
      const safeEncode = (s: string) => { try { return encodeURIComponent(s) } catch { return s } }
      for (const m of r2Media) {
        if (!m.filename || !m.url) continue
        urlByFilename.set(m.filename, m.url)
        const enc = safeEncode(m.filename)
        if (enc !== m.filename) urlByFilename.set(enc, m.url)
      }
      if (urlByFilename.size > 0) {
        const rows = await tx.select({ id: articles.id, content: articles.content })
          .from(articles)
          .where(sql`content LIKE ${'%/uploads/migrated/media/%'}`)
        for (const row of rows) {
          if (row.content === null) continue
          const original = String(row.content)
          const replacement = original.replace(
            /https?:\/\/[^\s"'<>]*\/uploads\/[^\s"'<>]*migrated\/media\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          ).replace(
            /\/uploads\/migrated\/media\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          )
          if (replacement === original) continue
          const [r] = await tx.execute(
            sql`UPDATE articles SET content = ${replacement} WHERE id = ${row.id}`,
          )
          articlesFixed += affectedRowsOrZero(r)
        }
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
