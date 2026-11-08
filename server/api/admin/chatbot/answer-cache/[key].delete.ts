import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'
import { deleteCachedAnswerWithAudit } from '../../../../services/admin-chatbot-answer-cache-admin'

/**
 * Xoá MỘT câu trả lời đã cache.
 *
 * Lượt hỏi sau sẽ gọi model lại và ghi hàng mới — xoá cache không bao giờ là "xoá câu
 * trả lời", chỉ là "đừng phát lại bản này nữa".
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')

  const key = getRouterParam(event, 'key') ?? ''
  if (!/^[0-9a-f]{64}$/u.test(key)) throw createError({ statusCode: 400, statusMessage: 'Mã cache không hợp lệ.' })

  // The row and its audit row in one transaction; null = nothing was deleted (services/admin-chatbot-answer-cache-admin.ts).
  const removed = await deleteCachedAnswerWithAudit(adminUser, key, getClientIp(event))

  if (removed === null) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy câu trả lời đã cache.' })
  return { ok: true, deleted: removed }
})
