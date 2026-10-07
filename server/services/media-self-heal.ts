/**
 * Tự vá.media — hai bước:
 *
 * 1. Upload lại R2 object cho những hàng `media` có `provider='r2'` nhưng R2 thực
 *    tế không có object (HeadObject 404). Đây là gap đã khiến 492 hàng trỏ tới
 *    URL R2 không tải được — upload content từ file local (nếu còn) hoặc báo
 *    thiếu file gốc. Không xoá file local ở đây (giữ làm fallback).
 *
 * 2. Repoint `articles.thumbnail_url` từ `/uploads/migrated/YYYY/MM/<file>`
 *    sang R2 URL khớp qua basename JOIN với `media.filename` (provider='r2',
 *    đã có object). Trả số bài được sửa.
 *
 * Idempotent: chạy lại không thay đổi kết quả. Tự backup SQL trước (`runBackup`).
 * Khoá MySQL `cdkt:media:self-heal` (timeout 0 — không xếp hàng).
 *
 * `dryRun: true` — chỉ phân tích, không upload/UPDATE; trả preview số lượng.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq, and, like, sql } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, articles, activityLogs } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { withNamedLock } from '../utils/named-lock'
import { headR2Object, uploadR2File } from '../utils/media-r2'
import { loadR2Config } from './media'
import { runBackup } from './backup'
import { logInfo, logWarn } from '../utils/logger'

const LOCK_NAME = 'cdkt:media:self-heal'

/**
 * Ảnh mặc định thay thế khi R2 object bị mất vĩnh viễn (file local cũng không còn).
 * Đặt trong `public/assets/` → IPX đọc được (local, không cần R2). SafeImg dùng
 * cùng fallback này → khớp tỉ lệ, không lệch layout.
 */
const DEFAULT_COVER = '/assets/default_cover_light.png'

export interface SelfHealReport {
  /** Số hàng `media` (provider='r2') được kiểm tra HeadObject. */
  r2Checked: number
  /** Số hàng R2 object thực sự tồn tại — không cần làm gì. */
  r2Ok: number
  /** Số hàng R2 object missing — cần upload lại. */
  r2Missing: number
  /** Số hàng đã upload lại thành công (file local còn). */
  r2Reuploaded: number
  /** Số hàng missing nhưng file local cũng không còn — không thể vá. */
  r2Lost: number
  /** Số hàng `articles.thumbnail_url` sẽ/đã được repoint sang R2 URL. */
  thumbnailsRepointed: number
  /**
   * Số hàng `articles.thumbnail_url` (và `media.url`) đã trỏ tới R2 URL hỏng
   * (r2Lost) → đổi sang ảnh mặc định `/assets/default_cover_light.png` để IPX
   * không còn fetch R2 404 (Triệt 404 console tận gốc — prov hàng lost).
   */
  thumbnailsDefaulted: number
  /** Số hàng `media.url` bị lost đã đổi sang ảnh mặc định (grid admin không vỡ). */
  mediaUrlsDefaulted: number
  /** Sampel filename missing (max 20) để hiển thị. */
  missingSamples: string[]
  backupStamp: string | null
}

export async function selfHealMedia(
  adminUserId: number | null,
  opts: { dryRun?: boolean } = {},
): Promise<SelfHealReport> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  const r2Config = await loadR2Config()
  if (!r2Config.accountId || !r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucket) {
    throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
  }

  const outcome = await withNamedLock(pool, LOCK_NAME, 0, async () => {
    let backupStamp: string | null = null
    if (!opts.dryRun) {
      try {
        const r = await runBackup('sql', 'pre-self-heal', adminUserId)
        backupStamp = r.stamp
      } catch (err) {
        logWarn({ event: 'media.self_heal_pre_backup_failed', error: err instanceof Error ? err.message : String(err) })
      }
    }

    const report: SelfHealReport = {
      r2Checked: 0,
      r2Ok: 0,
      r2Missing: 0,
      r2Reuploaded: 0,
      r2Lost: 0,
      thumbnailsRepointed: 0,
      thumbnailsDefaulted: 0,
      mediaUrlsDefaulted: 0,
      missingSamples: [],
      backupStamp,
    }

    // R2 URL của các hàng media bị lost (file R2 + local đều mất) — dùng ở Step 3
    // để sửa articles.thumbnail_url + media.url sang default cover.
    const lostR2Urls: string[] = []

    // ── Step 1: Kiểm tra + upload lại R2 object missing ─────────────────────
    // Chỉ xử lý provider='r2' (URL đã trỏ R2). Lấy tất cả — không phân trang — vì
    // chỉ ~3212 hàng, HeadObject network call là bottleneck, không phải query.
    const r2Rows = await db.select().from(media).where(eq(media.provider, 'r2'))
    report.r2Checked = r2Rows.length

    const reuploadedIds: number[] = []
    for (const row of r2Rows) {
      // storagePath với R2 chính là R2 key.
      const r2Key = row.storagePath
      if (!r2Key) continue
      const exists = await headR2Object(r2Key, r2Config)
      if (exists) {
        report.r2Ok += 1
        continue
      }
      report.r2Missing += 1
      if (report.missingSamples.length < 20) report.missingSamples.push(row.filename)

      if (opts.dryRun) continue

      // Tìm file local gốc theo URL local suy ra từ filename. Hai nguồn khả thi:
      //   public/uploads/<rel>                       (uploadLocalFile structure)
      //   public/uploads/migrated/YYYY/MM/<filename> (migrate cũ)
      // Thử lần lượt; không quét toàn bộ `uploads` (chậm) — chỉ suy đường dẫn.
      const localCandidates = candidateLocalPaths(row.filename)
      let buffer: Buffer | null = null
      for (const p of localCandidates) {
        try {
          buffer = await fs.readFile(p)
          break
        } catch { /* thử candidate tiếp */ }
      }
      if (!buffer) {
        report.r2Lost += 1
        // Chỉ push URL R2 thật (http) — nếu row.url đã là DEFAULT_COVER (đã vá
        // lần trước) thì không push, Step 3 sẽ không UPDATE lại (idempotent).
        if (row.url && row.url.startsWith('http')) lostR2Urls.push(row.url)
        logWarn({
          event: 'media.self_heal_r2_lost',
          mediaId: row.id,
          filename: row.filename,
          r2Key,
          reason: 'R2 object missing + file local không còn — không thể upload lại',
        })
        continue
      }

      // Upload lại. R2 key giữ nguyên (re-PUT idempotent) — không đổi URL/row.
      // Nếu filename đã thay đổi → uploadR2File sinh key mới từ filename; nhưng
      // vì storagePath cũ là r2Key, ta muốn giữ URL ổn định → bỏ qua re-upload
      // vào key mới. Cứ để uploadR2File quyết định (PUT đè ở cùng YYYY/MM/filename).
      try {
        await uploadR2File(buffer, row.filename, row.mimeType, r2Config)
        report.r2Reuploaded += 1
        reuploadedIds.push(row.id)
      } catch (err) {
        logWarn({
          event: 'media.self_heal_reupload_failed',
          mediaId: row.id,
          filename: row.filename,
          error: err instanceof Error ? err.message : String(err),
        })
        report.r2Lost += 1
        if (row.url && row.url.startsWith('http')) lostR2Urls.push(row.url)
      }
    }

    // ── Step 2: Repoint articles.thumbnail_url /uploads/migrated/... → R2 ─
    // Lấy danh sách media R2 đã có object (sau step 1) + chia theo basename.
    // Chỉ join khi provider='r2' và URL R2. Tránh sửa thumbnail đã đúng.
    const okR2Rows = await db.select({ filename: media.filename, url: media.url })
        .from(media)
        .where(eq(media.provider, 'r2'))
    const urlByFilename = new Map<string, string>()
    for (const r of okR2Rows) {
      if (r.url && r.url.startsWith('http')) urlByFilename.set(r.filename, r.url)
    }

    // Tìm articles có thumbnail_url dạng /uploads/migrated/... — chưa trỏ R2.
    const candidates = await db.select({ id: articles.id, thumb: articles.thumbnailUrl })
      .from(articles)
      .where(and(like(articles.thumbnailUrl, '%/uploads/migrated/%')))

    let repointed = 0
    if (!opts.dryRun) {
      await db.transaction(async (tx) => {
        for (const a of candidates) {
          if (!a.thumb) continue
          const basename = path.basename(a.thumb)
          const newUrl = urlByFilename.get(basename)
          if (!newUrl || newUrl === a.thumb) continue
          const [r] = await tx.execute(
            sql`UPDATE articles SET thumbnail_url = ${newUrl} WHERE id = ${a.id}`,
          )
          repointed += affectedRowsOrZero(r)
        }
        await tx.insert(activityLogs).values({
          userId: adminUserId,
          action: 'self_heal',
          resource: 'media',
          resourceId: null,
          meta: {
            r2Checked: report.r2Checked,
            r2Missing: report.r2Missing,
            r2Reuploaded: report.r2Reuploaded,
            r2Lost: report.r2Lost,
            thumbnailsRepointed: repointed,
            backupStamp,
            dryRun: false,
          },
        })
      })
    } else {
      // Dry-run — đếm số bài SẼ sửa (có khớp basename) mà không UPDATE.
      for (const a of candidates) {
        if (!a.thumb) continue
        const basename = path.basename(a.thumb)
        const newUrl = urlByFilename.get(basename)
        if (newUrl && newUrl !== a.thumb) repointed += 1
      }
    }
    report.thumbnailsRepointed = repointed

    // ── Step 3: Triệt 404 tận gốc — đổi thumbnail_url + media.url của hàng lost ─
    // `r2Lost` cases: R2 object missing VÀ file local cũng mất → không upload lại
    // được. Trước đây service chỉ log warn rồi bỏ → `thumbnail_url` vẫn trỏ R2 URL
    // hỏng → IPX fetch R2 404 → console đỏ + ảnh vỡ trên cổng (SafeImg chỉ fallback
    // client-side, 404 vẫn hiện Network). Giờ đổi sang `DEFAULT_COVER` (local, IPX
    // đọc từ public/ luôn 200) → IPX không bao giờ fetch R2 404 nữa.
    //
    // Match CHÍNH XÁC URL (WHERE thumbnail_url = R2Url), không LIKE substring —
    // tránh sửa nhầm bài có thumbnail R2 khác chia đoạn prefix chung.
    let thumbsDefaulted = 0
    let mediaDefaulted = 0
    // Dedupe lostR2Urls — 2 media row khác id rất hiếm chia cùng URL, nhưng nếu
    // có thì UPDATE đôi cùng kết quả không hại, chỉ thừa affectedRows đếm sai.
    const uniqueLostUrls = [...new Set(lostR2Urls)]
    if (uniqueLostUrls.length === 0) {
      report.thumbnailsDefaulted = 0
      report.mediaUrlsDefaulted = 0
    } else if (!opts.dryRun) {
      await db.transaction(async (tx) => {
        // 3a. articles.thumbnail_url = <lost R2 url> → DEFAULT_COVER
        for (const lostUrl of uniqueLostUrls) {
          const [r] = await tx.execute(
            sql`UPDATE articles SET thumbnail_url = ${DEFAULT_COVER} WHERE thumbnail_url = ${lostUrl}`,
          )
          thumbsDefaulted += affectedRowsOrZero(r)
        }
        // 3b. media.url = <lost R2 url> → DEFAULT_COVER (grid admin không vỡ).
        //     Giữ provider='r2' + storagePath nguyên — đây vẫn là hàng R2 "lost",
        //     chỉ thay URL hiển thị. Nếu admin upload lại gốc sau này, URL sẽ đè.
        for (const lostUrl of uniqueLostUrls) {
          const [r] = await tx.execute(
            sql`UPDATE media SET url = ${DEFAULT_COVER} WHERE url = ${lostUrl}`,
          )
          mediaDefaulted += affectedRowsOrZero(r)
        }
        await tx.insert(activityLogs).values({
          userId: adminUserId,
          action: 'self_heal_default_lost',
          resource: 'media',
          resourceId: null,
          meta: {
            lostCount: uniqueLostUrls.length,
            thumbnailsDefaulted: thumbsDefaulted,
            mediaUrlsDefaulted: mediaDefaulted,
            defaultCover: DEFAULT_COVER,
            backupStamp,
          },
        })
      })
    } else {
      // Dry-run — đếm số bài + media SẼ sửa mà không UPDATE.
      for (const lostUrl of uniqueLostUrls) {
        const articleRows = await db.select({ id: articles.id })
          .from(articles)
          .where(eq(articles.thumbnailUrl, lostUrl))
        thumbsDefaulted += articleRows.length
        const mediaRows = await db.select({ id: media.id })
          .from(media)
          .where(eq(media.url, lostUrl))
        mediaDefaulted += mediaRows.length
      }
    }
    report.thumbnailsDefaulted = thumbsDefaulted
    report.mediaUrlsDefaulted = mediaDefaulted

    return report
  })

  if (!outcome.acquired) throw new Error('Một lượt tự vá khác đang chạy. Thử lại sau.')

  const r = outcome.value
  logInfo({
    event: 'media.self_heal_complete',
    dryRun: opts.dryRun ?? false,
    r2Checked: r.r2Checked,
    r2Missing: r.r2Missing,
    r2Reuploaded: r.r2Reuploaded,
    thumbnailsRepointed: r.thumbnailsRepointed,
    thumbnailsDefaulted: r.thumbnailsDefaulted,
    mediaUrlsDefaulted: r.mediaUrlsDefaulted,
  })
  return r
}

/**
 * Suy ra các đường dẫn file local gốc có thể chứa `filename`. Thử theo thứ tự:
 *   1. /uploads/migrated/YYYY/MM/<filename>   (migrate cũ — phổ biến)
 *   2. /uploads/YYYY/MM/<filename>            (uploadLocalFile)
 *   3. /uploads/<filename>                      (legacy flat)
 * Trả tuyệt đối từ process.cwd(). Đơn giản — không quét directory.
 */
function candidateLocalPaths(filename: string): string[] {
  const root = path.resolve(process.cwd(), 'public', 'uploads')
  // Không biết YYYY/MM chính xác — thử rải vài tháng gần đây. Self-heal thường chạy
  // ngay sau khi phát hiện thiếu, nên file gốc ở tháng hiện tại hoặc tháng trước.
  const now = new Date()
  const months: string[] = []
  for (let back = 0; back < 13; back += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const yyyy = String(d.getFullYear())
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    months.push(`${yyyy}/${mm}`)
  }
  const migrated = months.map((m) => path.join(root, 'migrated', m, filename))
  const flat = months.map((m) => path.join(root, m, filename))
  const legacy = path.join(root, filename)
  return [...migrated, ...flat, legacy]
}
