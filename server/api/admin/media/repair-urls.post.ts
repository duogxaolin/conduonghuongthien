/**
 * POST /api/admin/media/repair-urls — vá URL ảnh hỏng hàng loạt.
 *
 * All bài đang `http://localhost:3000/uploads/migrated/YYYY/MM/*.jpeg` trong khi
 * file local đã bị xoá sau sync + `media.url` thiếu scheme
 * (`cdn1.delify.vn/...` → `http://localhost:3000/cdn1...`).
 * Endpoint này vá cả `media.url` + `articles.content` + `articles.thumbnail_url`
 * trong 1 transaction, tự backup SQL trước (snapshot recover thủ công), idempotent.
 *
 * Quyền `media.update` (cùng sync/repoint).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { repairMediaUrls } from '../../../services/media-repair'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  try {
    const result = await repairMediaUrls(adminUser.id ?? null)
    return {
      ok: true,
      ...result,
      message: `Đã vá: ${result.mediaFixed} URL media + ${result.articlesFixed} lượt thay trong bài viết + ${result.thumbnailsFixed} thumbnail bài`
        + (result.syncRepairError
          ? `. Bước vá lượt đồng bộ dở dang lỗi: ${result.syncRepairError} — bấm lại sau.`
          : result.syncUrlsRepaired === null
            ? ' (bỏ qua bước vá lượt đồng bộ dở dang vì đang có lượt đồng bộ chạy).'
            : ` + ${result.syncUrlsRepaired} URL dở dang từ lượt đồng bộ trước.`)
        + (result.backupStamp ? ` Snapshot: ${result.backupStamp}.` : ''),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt vá URL')) throw createError({ statusCode: 409, statusMessage: msg })
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
