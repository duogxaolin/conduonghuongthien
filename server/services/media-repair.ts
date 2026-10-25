/**
 * Vá URL ảnh hỏng hàng loạt trong `media.url` + `articles.content` +
 * `articles.thumbnail_url`.
 *
 * Ca anh đang gặp (all bài): sync đã chạy (Local 0 / R2 3212) nhưng rewrite hỏng
 * nên mọi bài vẫn `<img src="http://localhost:3000/uploads/migrated/media/*.jpeg">`
 * trong khi file local đã bị xoá. Kèm theo `media.url` thiếu scheme
 * (`cdn1.delify.vn/...`) → grid thành `http://localhost:3000/cdn1...`.
 *
 * Sau pentest 2026-10: ảnh production thực tế lưu `uploads/migrated/YYYY/MM/...`
 * (KHÔNG có `/media/` ở giữa — R2 key là `YYYY/MM/filename`, xem `media-r2.ts`),
 * và phần lớn ảnh 404 nằm ở `articles.thumbnail_url` (service cũ chỉ vá `content`
 * → nút bấm không sửa được thumbnail). Service mở rộng:
 *   - Pattern mới `/uploads/migrated/YYYY/MM/<file>` (không `/media/`).
 *   - UPDATE `articles.thumbnail_url`: fix scheme/prefix + repoint sang R2 URL
 *     qua basename JOIN với `media.filename`.
 *
 * Idempotent, < vài giây, tự backup SQL trước (đang khôi phục CSDL → dừng trước mọi lượt
 * ghi, `JobBlockedByRestoreError` 409). Không tải file — chỉ UPDATE chuỗi.
 */
import { eq, like, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, articles, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { runBackup } from './backup'
import { MEDIA_JOB_LOCK, abortJobIfRestoreInProgress } from './pre-job-backup'
import { MEDIA_SYNC_LOCK_NAME, repairInterruptedSyncRewrites } from './media-sync-rewrite'

/** `cdkt:media:repair-urls` — tên ở `MEDIA_JOB_LOCK` (lượt khôi phục đọc cùng danh sách). */
const LOCK_NAME = MEDIA_JOB_LOCK.repairUrls

export interface RepairResult {
  mediaFixed: number
  articlesFixed: number
  thumbnailsFixed: number
  /**
   * Số URL dở dang từ lượt đồng bộ local↔R2 bị cắt ngang đã được vá
   * (`repairInterruptedSyncRewrites`). `null` = bỏ qua (khoá sync đang bận, hoặc bước
   * này lỗi — xem `syncRepairError`).
   */
  syncUrlsRepaired: number | null
  /** Lỗi của riêng bước vá lượt đồng bộ dở dang (các bước khác đã commit). */
  syncRepairError: string | null
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
      // Đang khôi phục CSDL → dừng, chưa ghi gì (`pre-job-backup.ts`). Lỗi khác: vá tiếp,
      // không có bản chụp.
      abortJobIfRestoreInProgress(err, 'repair-urls', 'vá URL ảnh')
      logWarn({ event: 'media.repair_pre_backup_failed', error: err instanceof Error ? err.message : String(err) })
    }

    let mediaFixed = 0
    let articlesFixed = 0
    let thumbnailsFixed = 0

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

      // 2b. Thay `*/uploads/migrated/<file>` (cả absolute lẫn relative) bằng
      //     `media.url` R2 đúng — in-memory: đọc mỗi article một lần, thay bằng regex
      //     JS, ghi lại 1 câu UPDATE per article. Trước đây lặp từng filename ×
      //     (REGEXP_REPLACE scan cả cột LONGTEXT + REPLACE scan lại) = ~1920 quét full
      //     bảng, treo >95s với 960 file; migration khởi động phải < vài giây.
      //
      //     Hai pattern song song:
      //       `/uploads/migrated/media/<file>`  — migration seed cũ (có `/media/`)
      //       `/uploads/migrated/YYYY/MM/<file>` — R2 key thật (KHÔNG `/media/`,
      //       xem `media-r2.ts:31` key = `${YYYY}/${MM}/${filename}`). Trước đây
      //       service chỉ khớp pattern đầu → ảnh production `migrated/2026/08/`
      //       không được repoint, thumbnail 404 hàng loạt.
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
        // Chọn cả 2 pattern: `migrated/media/...` cũ + `migrated/YYYY/MM/...` R2 —
        // một query LIKE duy nhất bắt cả (dùng `%migrated/%` hẹp bằng check JS regex).
        const rows = await tx.select({ id: articles.id, content: articles.content })
          .from(articles)
          .where(sql`content LIKE ${'%/uploads/migrated/%'}`)
        for (const row of rows) {
          if (row.content === null) continue
          const original = String(row.content)
          const replacement = original.replace(
            /https?:\/\/[^\s"'<>]*\/uploads\/[^\s"'<>]*migrated\/media\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          ).replace(
            /\/uploads\/migrated\/media\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          ).replace(
            /https?:\/\/[^\s"'<>]*\/uploads\/migrated\/\d{4}\/\d{2}\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          ).replace(
            /\/uploads\/migrated\/\d{4}\/\d{2}\/([^\s"'<>\]?#]+)/g,
            (_match, filename: string) => urlByFilename.get(filename) ?? _match,
          )
          if (replacement === original) continue
          const [r] = await tx.execute(
            sql`UPDATE articles SET content = ${replacement} WHERE id = ${row.id}`,
          )
          articlesFixed += affectedRowsOrZero(r)
        }
      }

      // ── 3. Vá `articles.thumbnail_url` ────────────────────────────────
      // 3a. Double-prefix + scheme fix (giống content, cùng pattern hỏng)
      {
        const [r1] = await tx.execute(sql`UPDATE articles SET thumbnail_url = REPLACE(thumbnail_url, 'http://localhost:3000https://', 'https://') WHERE thumbnail_url LIKE 'http://localhost:3000https://%'`)
        thumbnailsFixed += affectedRowsOrZero(r1)
        const [r2] = await tx.execute(sql`UPDATE articles SET thumbnail_url = REPLACE(thumbnail_url, 'https://localhost:3000https://', 'https://') WHERE thumbnail_url LIKE 'https://localhost:3000https://%'`)
        thumbnailsFixed += affectedRowsOrZero(r2)
        const [r3] = await tx.execute(sql`UPDATE articles SET thumbnail_url = REPLACE(thumbnail_url, 'http://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn') WHERE thumbnail_url LIKE 'http://localhost:3000/cdn1.delify.vn%'`)
        thumbnailsFixed += affectedRowsOrZero(r3)
        const [r4] = await tx.execute(sql`UPDATE articles SET thumbnail_url = REPLACE(thumbnail_url, 'https://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn') WHERE thumbnail_url LIKE 'https://localhost:3000/cdn1.delify.vn%'`)
        thumbnailsFixed += affectedRowsOrZero(r4)
      }
      // 3b. Repoint `*/uploads/migrated/<file>` → R2 URL khớp qua basename JOIN
      //     với `media.filename` (provider='r2'). Logic giống self-heal step 2,
      //     nhưng self-heal kiệm R2 HeadObject — repair-urls vẫn chạy khi R2
      //     object tồn tại (đa số ca), và là chỗ duy nhất vá URL thumbnail khi
      //     ảnh đã trên R2 nhưng thumbnail_url vẫn trỏ local.
      if (urlByFilename.size > 0) {
        const thumbRows = await tx.select({ id: articles.id, thumb: articles.thumbnailUrl })
          .from(articles)
          .where(like(articles.thumbnailUrl, '%/uploads/migrated/%'))
        for (const row of thumbRows) {
          if (!row.thumb) continue
          // Bỏ query string + fragment trước khi tách basename.
          const clean = row.thumb.split(/[?#]/)[0] ?? ''
          const basename = clean.split('/').pop() ?? ''
          const newUrl = urlByFilename.get(basename)
          if (!newUrl || newUrl === row.thumb) continue
          const [r] = await tx.execute(
            sql`UPDATE articles SET thumbnail_url = ${newUrl} WHERE id = ${row.id}`,
          )
          thumbnailsFixed += affectedRowsOrZero(r)
        }
      }

      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: 'repair_urls',
        resource: 'media',
        resourceId: null,
        meta: { mediaFixed, articlesFixed, thumbnailsFixed, backupStamp, r2Count: r2Media.length },
      })
    })

    // ── 4. URL còn trỏ bản cũ của một lượt đồng bộ bị cắt ngang ───────────
    // Các bước trên chỉ biết mẫu `/uploads/migrated/...`. Lượt đồng bộ local↔R2
    // bị huỷ/restart giữa chừng (mã cũ) để lại `/uploads/YYYY/MM/...`, bản dịch,
    // khối trang… trỏ tệp đã xoá. Nút này là đường vào khi không còn ảnh local
    // nào để bấm "Đồng bộ" (nút đó bị khoá khi Local = 0). Dùng CHUNG khoá với
    // sync: đang có lượt sync chạy thì bỏ qua bước này (sync tự vá ở đầu lượt).
    // Các bước 1-3 đã commit: lỗi ở bước này không được biến cả lượt vá thành 500.
    let syncUrlsRepaired: number | null = null
    let syncRepairError: string | null = null
    try {
      const syncRepair = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, 0, async () =>
        repairInterruptedSyncRewrites(db, adminUserId),
      )
      if (syncRepair.acquired) syncUrlsRepaired = syncRepair.value.urlsRepaired
    } catch (err: unknown) {
      syncRepairError = err instanceof Error ? err.message : String(err)
      logWarn({ event: 'media.repair_sync_rewrites_failed', error: syncRepairError })
    }

    return { mediaFixed, articlesFixed, thumbnailsFixed, syncUrlsRepaired, syncRepairError, backupStamp }
  })

  if (!outcome.acquired) throw new Error('Một lượt vá URL khác đang chạy. Thử lại sau.')

  const r = outcome.value
  logInfo({ event: 'media.repair_complete', ...r })
  return r
}
