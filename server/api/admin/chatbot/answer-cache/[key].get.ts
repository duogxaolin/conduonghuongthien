import { requireResourcePermission } from '../../../../utils/permissions'
import { getAnswerCacheDetail } from '../../../../services/chatbot-answer-cache'
import { auditAnswerCacheView } from '../../../../services/admin-chatbot-answer-cache-view-audit'

/**
 * Một câu trả lời đã cache, đủ toàn văn + câu hỏi gợi ý + nguồn — thứ danh sách chỉ cho thấy
 * đoạn đầu. Quyền `chatbot_knowledge.read`, cùng danh sách: ai thấy được câu hỏi thì thấy được
 * câu đang được phát lại cho nó.
 *
 * Tên tham số là `key` ở cả ba tệp `[key].*` (bộ định tuyến giữ MỘT tên cho mỗi vị trí —
 * `tests/api-route-param-names.test.ts`).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'read')

  const key = getRouterParam(event, 'key') ?? ''
  if (!/^[0-9a-f]{64}$/u.test(key)) throw createError({ statusCode: 400, statusMessage: 'Mã cache không hợp lệ.' })

  const item = await getAnswerCacheDetail(key)
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy câu trả lời đã cache.' })

  // Cùng khuôn với danh sách: một dòng audit cho lượt ĐỌC; nhật ký không chứa toàn văn câu trả lời.
  // Best-effort: a failed insert is swallowed (services/admin-chatbot-answer-cache-view-audit.ts).
  await auditAnswerCacheView(adminUser, key)

  return { ok: true, item }
})
