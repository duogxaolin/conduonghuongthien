/**
 * Endpoint đồng bộ storage ảnh (bảng `media`) giữa local và R2.
 *
 * Body: `{ direction: 'to-r2' | 'to-local' }`.
 *
 * Quyền `media.update` — đổi `provider` + `url` + `storagePath` của hàng existing
 * là update, không phải create.
 *
 * ── Worker nền (không block HTTP) ────────────────────────────────────────────
 * Trước đây endpoint `await syncMediaStorage(...)` chạy đồng bộ → 3000 file
 * timeout. Giờ `startSyncJob` chỉ **khởi tạo** job + trả `{ jobId }` ngay (< 100ms).
 * Worker chạy nền trong tiến trình Nitro, từng batch 20 file, sleep 500ms giữa
 * batch. UI poll `GET /api/admin/media/sync-status` để xem tiến độ.
 *
 * Trước sync, worker tự `runBackup('all', 'pre-sync')` → snapshot recover thủ
 * công nếu thảm họa (không auto-rollback — restore toàn DB mất dữ liệu unrelated).
 * Đang khôi phục CSDL → worker dừng trước lượt ghi đầu tiên; endpoint này đã trả
 * `{ jobId }`, nên lý do nằm ở `sync-status` (`phase: 'failed'`, câu "Đang khôi phục…").
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { startSyncJob, type SyncDirection } from '../../../services/media-sync'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  const body = await readBody<{ direction?: string }>(event)
  const direction = body?.direction
  if (direction !== 'to-r2' && direction !== 'to-local') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Hướng đồng bộ không hợp lệ (chỉ nhận "to-r2" hoặc "to-local").',
    })
  }

  try {
    const { jobId, finished } = await startSyncJob(direction as SyncDirection, adminUser.id ?? null)
    // Khi job kết thúc (xong, huỷ hay lỗi giữa chừng — các hàng trước đó đã đổi URL và bản cũ đã xoá):
    // câu trả lời chatbot đã cache còn chép URL cũ không được phát lại. Không chờ: job chạy nhiều phút.
    // Job không đổi URL nào (bị chặn vì đang khôi phục CSDL, không có hàng) thì không đụng CSDL.
    void finished.then(
      job => (job.synced + job.urlsRepaired + job.articlesRewritten > 0 ? bumpAnswerCacheVersion() : undefined),
    ).catch(() => undefined)
    return { ok: true, jobId, message: 'Đã khởi tạo job sync. Theo dõi tiến độ qua /api/admin/media/sync-status.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Cấu hình Cloudflare R2')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    if (msg.includes('Một lượt đồng bộ')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
