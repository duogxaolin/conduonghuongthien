/**
 * POST /api/admin/media/repoint-r2-urls — đổi domain URL R2 cho ảnh + mọi nội dung
 * nhúng URL ảnh.
 *
 * Body: `{ oldDomain, newDomain }`.
 *
 * Ca sử dụng: đổi domain CDN R2 nhưng vẫn cùng R2 account + bucket → file đã ở R2
 * (storage_path không đổi), chỉ cần đổi URL: `media.url` (hàng R2) và 27 cột tham
 * chiếu (`URL_REFERENCE_TARGETS`), đúng ranh giới URL, trong một transaction cùng
 * dòng audit. Trả số hàng đã đổi theo từng cột (`byTarget`).
 *
 * Trước khi đổi, sao lưu SQL là BẮT BUỘC: hỏng → 500, không hàng nào đổi.
 * Idempotent — chạy 2 lần với cùng cặp domain → lần 2 không đổi gì.
 *
 * Quyền `media.update` — đổi URL hàng existing là update.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { RepointBackupError, RepointBusyError, RepointInputError, repointR2Urls } from '../../../services/media-repoint'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  const body = await readBody<{ oldDomain?: string, newDomain?: string }>(event)
  const oldDomain = body?.oldDomain
  const newDomain = body?.newDomain

  if (typeof oldDomain !== 'string' || typeof newDomain !== 'string' || !oldDomain || !newDomain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cần nhập cả domain cũ và domain mới.',
    })
  }

  try {
    const result = await repointR2Urls(oldDomain, newDomain, adminUser.id ?? null)
    return {
      ok: true,
      ...result,
      message: `Đã đổi URL: ${result.mediaUpdated} ảnh + ${result.contentRowsUpdated} hàng nội dung. Snapshot: ${result.backupStamp}.`,
    }
  } catch (err: unknown) {
    if (err instanceof RepointInputError) throw createError({ statusCode: 400, statusMessage: err.message })
    if (err instanceof RepointBusyError) throw createError({ statusCode: 409, statusMessage: err.message })
    if (err instanceof RepointBackupError) throw createError({ statusCode: 500, statusMessage: err.message })
    throw createError({ statusCode: 500, statusMessage: err instanceof Error ? err.message : String(err) })
  }
})
