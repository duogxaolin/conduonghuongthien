/**
 * POST /api/admin/media/scan — khởi tạo job quét thư mục ảnh mồ côi.
 *
 * Worker chạy nền, từng batch 50 file, sleep 200ms. UI poll
 * `GET /api/admin/media/scan-status` để xem tiến độ.
 *
 * Body (tuỳ chọn): `{ autoRepointToR2: true }` — upload R2 ngay khi nhập hàng
 * `media` (provider='r2'), giữ file local làm fallback. Mặc định false.
 *
 * Quyền `media.create` — quét tạo hàng `media` mới.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { startScanJob } from '../../../services/media-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'create')

  let autoRepointToR2 = false
  try {
    const body = await readBody(event)
    if (body && typeof body === 'object' && typeof (body as { autoRepointToR2?: unknown }).autoRepointToR2 === 'boolean') {
      autoRepointToR2 = (body as { autoRepointToR2: boolean }).autoRepointToR2
    }
  } catch { /* body rỗng — giữ false */ }

  try {
    const { jobId } = await startScanJob(adminUser.id ?? null, { autoRepointToR2 })
    return {
      ok: true,
      jobId,
      message: autoRepointToR2
        ? 'Đã khởi tạo job quét + tự đẩy R2. Theo dõi tiến độ qua /api/admin/media/scan-status.'
        : 'Đã khởi tạo job quét. Theo dõi tiến độ qua /api/admin/media/scan-status.',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt quét')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    if (msg.includes('Cấu hình Cloudflare R2')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
