/**
 * One reader and every comment they have written, newest first.
 *
 * This is the most personal-data-dense read in the admin panel — a named citizen,
 * their email, their address, and everything they have said in public — so it is
 * gated on `readers.read` and audited with the reader's own id, not just "someone
 * opened a detail page" (design.md D14).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { auditReaderRead, getReaderDetail } from '../../../services/readers'

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'read')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã người đọc không hợp lệ.' })
  }

  const detail = await getReaderDetail(Math.floor(id))
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy tài khoản người đọc.' })

  await auditReaderRead({
    actorId:    actor.id,
    resourceId: detail.reader.id,
    meta:       { operation: 'detail', commentCount: detail.comments.length },
  })

  return { ok: true, ...detail }
})
