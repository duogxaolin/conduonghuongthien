/**
 * POST /api/admin/media/scan — khởi tạo job quét thư mục ảnh mồ côi.
 *
 * Worker chạy nền, từng batch 50 file, sleep 200ms. UI poll
 * `GET /api/admin/media/scan-status` để xem tiến độ.
 *
 * Quyền `media.create` — quét tạo hàng `media` mới.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { startScanJob } from '../../../services/media-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  try {
    const { jobId } = await startScanJob(adminUser.id ?? null)
    return { ok: true, jobId, message: 'Đã khởi tạo job quét. Theo dõi tiến độ qua /api/admin/media/scan-status.' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt quét')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
