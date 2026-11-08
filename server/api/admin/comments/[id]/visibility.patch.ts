/**
 * Ẩn hoặc hiện lại một bình luận (toggle isHidden).
 *
 * Khác với xoá: ẩn giữ lại hàng để officer xem lại / khôi phục. Tương đương
 * `approve`/`reject_delete` của queue resolve nhưng tác động trực tiếp lên
 * comment, không qua hàng đối soát — officer đã xem comment ở tab "Đã ẩn"
 * và quyết định nhanh.
 *
 * `flagReason` (tuỳ chọn) ghi lý do ẩn; bỏ trống khi hiện lại sẽ xoá reason.
 */
import { requireResourcePermission } from '../../../../utils/permissions'
import { findCommentVisibility, setCommentVisibilityWithAudit } from '../../../../services/admin-comments-visibility'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'comments', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bình luận không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const hidden = body?.hidden === true
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 255) : ''

  const existing = await findCommentVisibility(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Bình luận không tồn tại.' })
  }

  if (existing.isHidden === hidden && !reason) {
    return { ok: true, id: Math.floor(id), hidden }
  }

  // The change and its audit row in one transaction; a comment deleted since the read
  // above is a 404 decided there (services/admin-comments-visibility.ts).
  await setCommentVisibilityWithAudit(actor.id ?? null, id, hidden, reason)

  return { ok: true, id: Math.floor(id), hidden }
})
