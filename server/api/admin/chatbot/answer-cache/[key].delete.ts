import { eq } from 'drizzle-orm'
import { activityLogs, chatbotAnswerCache } from '../../../../db/schema'
import { getDb } from '../../../../utils/db'
import { affectedRowsOrZero } from '../../../../utils/affected-rows'
import { requireResourcePermission } from '../../../../utils/permissions'
import { getClientIp } from '../../../../utils/client-ip'

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

  const db = getDb()
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ question: chatbotAnswerCache.question, kind: chatbotAnswerCache.kind })
      .from(chatbotAnswerCache)
      .where(eq(chatbotAnswerCache.cacheKey, key))
      .limit(1)
    const deleted = await tx.delete(chatbotAnswerCache).where(eq(chatbotAnswerCache.cacheKey, key))
    const count = affectedRowsOrZero(deleted)
    if (count === 0) return null
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'chatbot_knowledge',
      resourceId: null,
      meta: { type: 'answer_cache_delete', cacheKey: key, question: row?.question ?? null, kind: row?.kind ?? null, ip: getClientIp(event) },
    })
    return count
  })

  if (removed === null) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy câu trả lời đã cache.' })
  return { ok: true, deleted: removed }
})
