/**
 * Đồng bộ storage ảnh (bảng `media`) giữa local disk và Cloudflare R2.
 *
 * Ca sử dụng: ảnh đang ở local muốn chuyển hết lên R2 (hoặc ngược lại) mà không
 * mất hàng CSDL, không mất liên kết trong bài viết. Một nút bấm — tải hết sang
 * bên kia, xoá bản cũ, cập nhật `provider` + `url` + `storagePath` trong SQL,
 * rồi thay URL cũ trong `articles.content` rich-text.
 *
 * **Thứ tự xoá file sau SQL commit** (cùng tiền lệ `deleteMediaById`): file đã
 * xoá khỏi đĩa/R2 thì rollback transaction không lấy lại được, nên gói nó vào
 * chỉ tạo ra trạng thái tệ hơn — hàng còn nguyên và trông như file vẫn ở đó.
 *
 * **File hỏng → bỏ qua + đi tiếp** (try/catch mỗi hàng). Một file R2 fail không
 * chặn cả lượt sync — đã chuyển X file xong thì vẫn giữ X, file hỏng vào
 * `skipped` + `errors`.
 *
 * **Rich-text thay SAU sync commit** — nếu sync rollback thì `articles.content`
 * không bị sửa. Chỉ thay URL khớp chính xác `media.url` cũ của hàng đã sync.
 *
 * **Khoá MySQL `cdkt:media:sync-storage`** (timeout 0) — hai lượt sync không
 * chạy chồng: moving 3000 file giữa local và R2 là race nếu chạy song song.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'

import { getDb, getPool } from '../utils/db'
import { media, activityLogs, articles } from '../db/schema'
import { uploadLocalFile, deleteLocalFile } from '../utils/media-local'
import { uploadR2File, deleteR2File, getR2Object, type R2Config } from '../utils/media-r2'
import { loadR2Config } from './media'
import { withNamedLock } from '../utils/named-lock'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logInfo, logWarn } from '../utils/logger'

const LOCK_NAME = 'cdkt:media:sync-storage'
const LOCK_TIMEOUT_SECONDS = 0

export type SyncDirection = 'to-r2' | 'to-local'

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
  /** Số bài viết `articles.content` đã được thay URL. */
  articlesRewritten: number
}

/** Lưu cặp URL để thay trong rich-text sau khi sync. */
interface UrlRewrite {
  oldUrl: string
  newUrl: string
}

function hasR2Config(config: R2Config): boolean {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket)
}

/**
 * Thay URL cũ bằng URL mới trong `articles.content`. Dùng SQL `REPLACE()`
 * (MySQL) để một query cập nhật tất cả occurrence của oldUrl trong mỗi bài.
 * Trả số bài đã sửa (affected rows).
 *
 * Không regex, không split/join phía app — `REPLACE()` là chuỗi chính xác,
 * MySQL xử lý trên server nên không phải tải content về RAM để sửa.
 */
async function rewriteArticleImageUrls(
  db: ReturnType<typeof getDb>,
  rewrites: UrlRewrite[],
  adminUserId: number | null,
): Promise<number> {
  let totalRewritten = 0
  for (const { oldUrl, newUrl } of rewrites) {
    if (!oldUrl || !newUrl || oldUrl === newUrl) continue
    try {
      const [updateRes] = await db.execute(
        // `REPLACE` trong MySQL an toàn với chuỗi: thay mọi occurrence của oldUrl.
        // `LIKE` khớp bài chứa oldUrl, `REPLACE` đổi tất cả occurrence trong bài đó.
        `UPDATE articles SET content = REPLACE(content, ?, ?) WHERE content LIKE ?`,
        [oldUrl, newUrl, `%${oldUrl}%`],
      )
      const affected = affectedRowsOrZero(updateRes)
      if (affected > 0) {
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
 * Sync một hàng `media` từ local lên R2. Trả `{ newUrl, newStoragePath, rewrite }`
 * hoặc ném lỗi (caller bắt + bỏ qua).
 */
async function syncOneToR2(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Đọc file local. storagePath là đường dẫn tuyệt đối.
  const buffer = await fs.readFile(item.storagePath)

  // Upload R2 — giữ filename gốc (không thêm timestamp) để URL ổn định.
  // Nếu R2 key trùng (cùng YYYY/MM/filename) thì PUT ghi đè — idempotent.
  const { url: r2Url, storagePath: r2Key } = await uploadR2File(
    buffer,
    item.filename,
    item.mimeType,
    r2Config,
  )

  const oldUrl = item.url
  const oldStoragePath = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'r2',
      url: r2Url,
      storagePath: r2Key,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-r2', oldUrl, newUrl: r2Url, oldStoragePath, newStoragePath: r2Key },
    })
  })

  // Xoá file local SAU khi SQL commit — rollback không lấy lại file đã xoá.
  await deleteLocalFile(oldStoragePath)

  return { rewrite: { oldUrl, newUrl: r2Url } }
}

/**
 * Sync một hàng `media` từ R2 về local. Trả `{ rewrite }` hoặc ném lỗi.
 */
async function syncOneToLocal(
  db: ReturnType<typeof getDb>,
  item: typeof media.$inferSelect,
  r2Config: R2Config,
  adminUserId: number | null,
): Promise<{ rewrite: UrlRewrite }> {
  // Download R2 object — storagePath chính là R2 key.
  const buffer = await getR2Object(item.storagePath, r2Config)

  // Ghi local — uploadLocalFile tạo YYYY/MM/filename, trả url + storagePath tuyệt đối.
  const { url: localUrl, storagePath: localStoragePath } = await uploadLocalFile(buffer, item.filename)

  const oldUrl = item.url
  const oldR2Key = item.storagePath

  await db.transaction(async (tx) => {
    await tx.update(media).set({
      provider: 'local',
      url: localUrl,
      storagePath: localStoragePath,
    }).where(eq(media.id, item.id))
    await tx.insert(activityLogs).values({
      userId: adminUserId,
      action: 'update',
      resource: 'media',
      resourceId: item.id,
      meta: { sync: 'to-local', oldUrl, newUrl: localUrl, oldStoragePath: oldR2Key, newStoragePath: localStoragePath },
    })
  })

  // Xoá R2 object SAU khi SQL commit.
  await deleteR2File(oldR2Key, r2Config)

  return { rewrite: { oldUrl, newUrl: localUrl } }
}

export async function syncMediaStorage(
  direction: SyncDirection,
  adminUserId: number | null,
): Promise<SyncResult> {
  const db = getDb()
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  // Đọc R2 config image (group `media` settings).
  const r2Config = await loadR2Config()
  if (direction === 'to-r2' && !hasR2Config(r2Config)) {
    throw new Error('Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
  }

  // Khoá MySQL named lock — timeout 0 (không xếp hàng).
  const outcome = await withNamedLock(pool, LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    // Chọn hàng cần sync theo direction.
    const items = direction === 'to-r2'
      ? await db.select().from(media).where(eq(media.provider, 'local'))
      : await db.select().from(media).where(eq(media.provider, 'r2'))

    let synced = 0
    let skipped = 0
    const errors: string[] = []
    const rewrites: UrlRewrite[] = []

    for (const item of items) {
      try {
        const { rewrite } = direction === 'to-r2'
          ? await syncOneToR2(db, item, r2Config, adminUserId)
          : await syncOneToLocal(db, item, r2Config, adminUserId)
        synced += 1
        rewrites.push(rewrite)
      } catch (err) {
        skipped += 1
        errors.push(item.filename)
        logWarn({
          event: 'media.sync_item_failed',
          direction,
          mediaId: item.id,
          filename: item.filename,
          error: err instanceof Error ? err.message : String(err),
        })
        // Không throw — một file hỏng không sập cả lượt.
      }
    }

    // Thay URL trong rich-text articles.content SAU khi sync commit.
    let articlesRewritten = 0
    if (rewrites.length > 0) {
      articlesRewritten = await rewriteArticleImageUrls(db, rewrites, adminUserId)
    }

    return { synced, skipped, errors, articlesRewritten }
  })

  if (!outcome.acquired) {
    throw new Error('Một lượt đồng bộ khác đang chạy. Thử lại sau.')
  }

  const result = outcome.value

  // Audit tổng — ngoài transaction (sync tạo nhiều hàng riêng, không có "một"
  // transaction bao bọc). Cùng pattern `scan_uploads`.
  if (result.synced > 0 || result.skipped > 0) {
    try {
      await db.insert(activityLogs).values({
        userId: adminUserId,
        action: 'sync_storage',
        resource: 'media',
        resourceId: null,
        meta: {
          direction,
          synced: result.synced,
          skipped: result.skipped,
          articlesRewritten: result.articlesRewritten,
        },
      })
    } catch {
      // Audit hỏng không làm hỏng lượt sync đã thành công.
    }
    logInfo({ event: 'media.sync_complete', direction, ...result })
  }

  return result
}
