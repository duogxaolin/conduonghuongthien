/**
 * Đường đồng bộ CŨ chạy trong một request HTTP (`syncMediaStorage`). Không endpoint nào
 * gọi nó nữa — UI dùng worker nền (`media-sync-worker.ts`); giữ lại cho tương thích và
 * cho `tests/media-sync-rewrite-integration.test.ts` chạy SQL thật qua nó.
 *
 * Cùng khoá, cùng lượt vá, cùng đơn vị nguyên tử từng hàng như worker nền. KHÔNG tăng
 * phiên bản cache câu trả lời chatbot (worker thì có): không có đường vào nào tới đây từ
 * handler, nên cổng `chatbot-answer-cache-invalidation` không quét nó.
 */
import { getDb, getPool } from '../utils/db'
import { activityLogs } from '../db/schema'
import { loadR2Config } from './media'
import { assertUsableR2Config } from '../utils/media-r2'
import { withNamedLock } from '../utils/named-lock'
import { logInfo, logWarn } from '../utils/logger'
import { MEDIA_SYNC_LOCK_NAME, repairInterruptedSyncRewrites } from './media-sync-rewrite'
import { hasR2Config, syncOneToR2, syncOneToLocal } from './media-sync-files'
import { BUSY_MESSAGE, LOCK_TIMEOUT_SECONDS, selectItems, type SyncDirection, type SyncResult } from './media-sync-shared'

/** Chạy sync đồng bộ trong 1 HTTP request — không khuyến nghị (3000 file là timeout). */
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
  if (hasR2Config(r2Config)) assertUsableR2Config(r2Config)

  // Khoá MySQL named lock — timeout 0 (không xếp hàng).
  const outcome = await withNamedLock(pool, MEDIA_SYNC_LOCK_NAME, LOCK_TIMEOUT_SECONDS, async () => {
    const repaired = await repairInterruptedSyncRewrites(db, adminUserId)
    const items = await selectItems(direction)

    let synced = 0
    let skipped = 0
    const errors: string[] = []
    let articlesRewritten = repaired.rowsRewritten

    for (const item of items) {
      try {
        const { rowsRewritten } = direction === 'to-r2'
          ? await syncOneToR2(db, item, r2Config, adminUserId)
          : await syncOneToLocal(db, item, r2Config, adminUserId)
        synced += 1
        articlesRewritten += rowsRewritten
      } catch (err: unknown) {
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

    return { synced, skipped, errors, articlesRewritten }
  })

  if (!outcome.acquired) {
    throw new Error(BUSY_MESSAGE)
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
