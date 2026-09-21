/**
 * POST /api/admin/media/repoint-r2-urls — đổi domain URL R2 cho ảnh + bài viết.
 *
 * Body: `{ oldDomain, newDomain }`.
 *
 * Ca sử dụng: đổi domain CDN R2 nhưng vẫn cùng R2 account + bucket → file đã
 * ở R2 (storage_path không đổi), chỉ cần đổi URL trong `media.url` +
 * `articles.content`. Chạy < 2 giây, không tải file, không cần worker nền.
 *
 * Trước repoint, tự backup SQL (snapshot recover thủ công). Idempotent — chạy
 * 2 lần với cùng oldDomain → lần 2 không khớp gì.
 *
 * Quyền `media.update` — đổi URL hàng existing là update.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { repointR2Urls } from '../../../services/media-repoint'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  const body = await readBody<{ oldDomain?: string, newDomain?: string }>(event)
  const oldDomain = body?.oldDomain
  const newDomain = body?.newDomain

  if (!oldDomain || !newDomain) {
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
      message: `Đã đổi URL: ${result.mediaUpdated} ảnh + ${result.articlesUpdated} bài viết.${result.backupStamp ? ` Snapshot: ${result.backupStamp}.` : ''}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Domain') || msg.includes('không hợp lệ') || msg.includes('giống nhau')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    if (msg.includes('Một lượt đổi domain')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
