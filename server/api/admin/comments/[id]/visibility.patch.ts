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
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { articleComments, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

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

  const db = getDb()
  const [existing] = await db
    .select({ id: articleComments.id, isHidden: articleComments.isHidden })
    .from(articleComments)
    .where(eq(articleComments.id, Math.floor(id)))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Bình luận không tồn tại.' })
  }

  if (existing.isHidden === hidden && !reason) {
    return { ok: true, id: Math.floor(id), hidden }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(articleComments)
      .set({
        isHidden: hidden,
        flagReason: hidden ? (reason || null) : null,
      })
      .where(eq(articleComments.id, Math.floor(id)))

    await tx.insert(activityLogs).values({
      userId: actor.id ?? null,
      action: 'update',
      resource: 'comments',
      resourceId: Math.floor(id),
      meta: { visibility: hidden ? 'hidden' : 'visible', reason: hidden ? reason : null },
    })
  })

  return { ok: true, id: Math.floor(id), hidden }
})
