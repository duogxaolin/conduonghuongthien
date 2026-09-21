/**
 * Endpoint đồng bộ storage ảnh (bảng `media`) giữa local và R2.
 *
 * Body: `{ direction: 'to-r2' | 'to-local' }`.
 *
 * Quyền `media.update` — đổi `provider` + `url` + `storagePath` của hàng existing
 * là update, không phải create. Service `media-sync.ts` lo logic; endpoint chỉ
 * nhận request + check quyền + trả kết quả.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { syncMediaStorage, type SyncDirection } from '../../../services/media-sync'

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
    const result = await syncMediaStorage(direction as SyncDirection, adminUser.id ?? null)
    return { ok: true, ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Lỗi cấu hình R2 hoặc lock busy → 400/409 để UI báo đúng.
    if (msg.includes('Cấu hình Cloudflare R2')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    if (msg.includes('Một lượt đồng bộ khác')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
