/**
 * Quét ảnh thumbnail hỏng + thay bằng ảnh mặc định.
 *
 * Khác `media-self-heal.ts` (chạy nền, thay **tất cả** URL lost): service này cho
 * admin **kiểm soát** — xem danh sách bài hỏng, chọn từng bài / tất cả, chọn
 * ảnh mặc định cụ thể. Cả hai cùng tồn tại.
 *
 * **Dry-run** (mặc định): quét tất cả `articles` có `thumbnail_url` không null.
 * Với mỗi bài, kiểm tra URL:
 *   - R2 URL (`http` + thuộc `r2_public_url`) → `headR2Object` (HeadObject 404).
 *   - `/uploads/...` → `fs.access(path.resolve('public', url))`.
 *   - `/assets/...` → `fs.access` (ảnh tĩnh luôn tồn tại → không bao giờ hỏng).
 *   - `data:` URI → skip (luôn valid).
 * Trả danh sách bài hỏng + reason.
 *
 * **Fix** (`dryRun: false` + `fixIds`): UPDATE `articles.thumbnail_url = defaultCover`
 * WHERE id IN fixIds. Bọc trong `db.transaction` + insert `activityLogs`
 * (action `articles_fix_thumbnails`). Tự backup SQL trước (`runBackup`).
 *
 * Idempotent: chạy lại không thay đổi kết quả (bài đã có default cover không
 * còn trong danh sách hỏng). Khoá MySQL `cdkt:articles:scan-thumbnails`
 * (timeout 0 — không xếp hàng) chống chạy chồng.
 *
 * Quyền `media.update` (xem handler) — cùng họ self-heal/repair-urls.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { inArray, isNotNull, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { articles, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { headR2Object } from '../utils/media-r2'
import { loadR2Config } from './media'
import { runBackup } from './backup'
import { abortJobIfRestoreInProgress } from './pre-job-backup'
import { logInfo, logWarn } from '../utils/logger'

const LOCK_NAME = 'cdkt:articles:scan-thumbnails'

/**
 * Ảnh mặc định thay thế — phải nằm trong `public/assets/` (IPX đọc được, không
 * cần R2). Khớp với `DEFAULT_IMAGES` trong `MediaLibraryModal.vue` + fallback
 * `SafeImg.vue`.
 */
export const DEFAULT_COVER = '/assets/default_cover_light.png'

export type BrokenReason = 'r2_404' | 'local_missing'

export interface BrokenArticle {
  id: number
  title: string
  thumbnailUrl: string
  reason: BrokenReason
}

export interface ScanReport {
  /** Tổng số bài có thumbnail_url không null được quét. */
  scanned: number
  /** Số bài thumbnail hỏng. */
  brokenCount: number
  /** Danh sách bài hỏng (max 500 — chống payload quá lớn). */
  broken: BrokenArticle[]
  /** dry-run hay fix. */
  dryRun: boolean
  /** Chỉ có khi fix: số bài đã UPDATE. */
  fixedCount?: number
  /** Chỉ có khi fix: ảnh mặc định đã dùng. */
  defaultCover?: string
  /** Chỉ có khi fix: stamp backup SQL trước khi sửa. */
  backupStamp?: string | null
}

/**
 * Kiểm tra một thumbnail URL có thực sự tải được không.
 *
 * - `data:` URI → luôn valid (skip).
 * - `/assets/...` → check `fs.exists` trong `public/` (ảnh tĩnh).
 * - `/uploads/...` → check `fs.exists` trong `public/`.
 * - R2 URL (http/https, thuộc `r2Config.publicUrl`) → `headR2Object` với key
 *   suy ra từ URL (strip publicUrl prefix).
 * - URL http khác (không thuộc R2) → skip (không quét ngoại miền).
 *
 * Trả `{ broken: boolean, reason }`. `broken: false` nghĩa là ảnh còn tốt.
 */
async function checkThumbnail(
  url: string,
  r2Config: { publicUrl: string } | null,
): Promise<{ broken: boolean; reason: BrokenReason | null }> {
  // data: URI — luôn valid.
  if (url.startsWith('data:')) return { broken: false, reason: null }

  // Ảnh tĩnh local /uploads hoặc /assets.
  if (url.startsWith('/')) {
    try {
      const localPath = path.resolve(process.cwd(), 'public', url)
      const exists = await fs.access(localPath).then(() => true).catch(() => false)
      return { broken: !exists, reason: exists ? null : 'local_missing' }
    } catch {
      return { broken: true, reason: 'local_missing' }
    }
  }

  // URL http/https — chỉ check nếu thuộc R2 publicUrl.
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!r2Config || !r2Config.publicUrl) return { broken: false, reason: null }
    const publicUrl = r2Config.publicUrl.replace(/\/$/, '')
    // Không thuộc R2 → skip (không quét ngoại miền — tránh network call chậm).
    if (!url.startsWith(publicUrl)) return { broken: false, reason: null }
    // R2 key = phần URL sau publicUrl prefix.
    const key = url.slice(publicUrl.length).replace(/^\//, '')
    if (!key) return { broken: true, reason: 'r2_404' }
    const exists = await headR2Object(key, r2Config as Parameters<typeof headR2Object>[1])
    return { broken: !exists, reason: exists ? null : 'r2_404' }
  }

  // Không khớp dạng nào → skip (không báo hỏng).
  return { broken: false, reason: null }
}

/**
 * Quét + (tuỳ chọn) fix thumbnail hỏng.
 *
 * `dryRun: true` → chỉ trả danh sách hỏng.
 * `dryRun: false` + `fixIds` → UPDATE thumbnail_url cho `fixIds` sang
 * `defaultCover` (mặc định `DEFAULT_COVER`). Tự backup trước; đang khôi phục CSDL →
 * dừng trước mọi lượt ghi (`JobBlockedByRestoreError`, 409).
 */
export async function scanArticleThumbnails(
  adminUserId: number | null,
  opts: { dryRun?: boolean; fixIds?: number[]; defaultCover?: string } = {},
): Promise<ScanReport> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const dryRun = opts.dryRun !== false
  const defaultCover = opts.defaultCover && opts.defaultCover.startsWith('/assets/')
    ? opts.defaultCover
    : DEFAULT_COVER

  // Validate fixIds — chỉ số nguyên dương, dedupe.
  const fixIds = (opts.fixIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const uniqueFixIds = [...new Set(fixIds)]

  const outcome = await withNamedLock(pool, LOCK_NAME, 0, async () => {
    // Load R2 config — đọc 1 lần, không phải per-row.
    let r2Config: { publicUrl: string; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null = null
    try {
      const cfg = await loadR2Config()
      if (cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket) {
        r2Config = cfg
      }
    } catch (err) {
      logWarn({
        event: 'articles.thumbnail_scan_r2_config_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // ── Fix mode ──────────────────────────────────────────────────────────
    if (!dryRun && uniqueFixIds.length > 0) {
      let backupStamp: string | null = null
      try {
        const r = await runBackup('sql', 'pre-fix-thumbnails', adminUserId)
        backupStamp = r.stamp
      } catch (err) {
        // Đang khôi phục CSDL → dừng, chưa ghi gì (`pre-job-backup.ts`). Lỗi khác: sửa
        // tiếp, không có bản chụp.
        abortJobIfRestoreInProgress(err, 'fix-thumbnails', 'sửa ảnh đại diện bài viết')
        logWarn({
          event: 'articles.thumbnail_fix_pre_backup_failed',
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Lấy danh sách bài sẽ sửa (chỉ bài thực sự tồn tại + đang có thumbnail
      // khác defaultCover — idempotent: không UPDATE bài đã đúng).
      const targets = await db.select({ id: articles.id, thumb: articles.thumbnailUrl })
        .from(articles)
        .where(inArray(articles.id, uniqueFixIds))

      let fixed = 0
      await db.transaction(async (tx) => {
        for (const a of targets) {
          if (!a.thumb || a.thumb === defaultCover) continue
          const [r] = await tx.execute(
            sql`UPDATE articles SET thumbnail_url = ${defaultCover} WHERE id = ${a.id}`,
          )
          fixed += affectedRowsOrZero(r)
        }
        await tx.insert(activityLogs).values({
          userId: adminUserId,
          action: 'articles_fix_thumbnails',
          resource: 'media',
          resourceId: null,
          meta: {
            fixedCount: fixed,
            defaultCover,
            fixIds: uniqueFixIds,
            backupStamp,
          },
        })
      })

      return {
        scanned: 0,
        brokenCount: 0,
        broken: [],
        dryRun: false,
        fixedCount: fixed,
        defaultCover,
        backupStamp,
      } satisfies ScanReport
    }

    // ── Scan mode (dry-run) ───────────────────────────────────────────────
    const rows = await db.select({ id: articles.id, title: articles.title, thumb: articles.thumbnailUrl })
      .from(articles)
      .where(isNotNull(articles.thumbnailUrl))

    // Quét song song theo chunk 10 — HeadObject R2 là network call, tuần tự 5000
    // bài sẽ mất nhiều phút. Chunk 10 cân bằng throughput + R2 rate limit.
    const broken: BrokenArticle[] = []
    const CHUNK = 10
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const results = await Promise.all(
        chunk.map(async (row) => {
          if (!row.thumb) return null
          const r = await checkThumbnail(row.thumb, r2Config)
          if (!r.broken || !r.reason) return null
          return {
            id: row.id,
            title: row.title,
            thumbnailUrl: row.thumb,
            reason: r.reason,
          } as BrokenArticle
        }),
      )
      for (const b of results) {
        if (b) broken.push(b)
        // Chống payload quá lớn — 500 bài hỏng đủ để admin xem + chọn.
        if (broken.length >= 500) break
      }
      if (broken.length >= 500) break
    }

    return {
      scanned: rows.length,
      brokenCount: broken.length,
      broken,
      dryRun: true,
    } satisfies ScanReport
  })

  if (!outcome.acquired) throw new Error('Một lượt quét thumbnail khác đang chạy. Thử lại sau.')

  const r = outcome.value
  logInfo({
    event: 'articles.thumbnail_scan_complete',
    dryRun: r.dryRun,
    scanned: r.scanned,
    brokenCount: r.brokenCount,
    fixedCount: r.fixedCount ?? 0,
  })
  return r
}
