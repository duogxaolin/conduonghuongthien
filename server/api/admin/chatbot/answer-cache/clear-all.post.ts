import { requireResourcePermission } from '../../../../utils/permissions'
import { clearAnswerCache } from '../../../../services/chatbot-answer-cache'
import { logInfo } from '../../../../utils/logger'

/**
 * Xoá TOÀN BỘ cache câu trả lời.
 *
 * Dùng khi cán bộ muốn chắc chắn không còn bản cũ nào được phát lại (ví dụ sau khi sửa
 * hàng loạt nội dung bằng SQL tay, đường đó không đi qua `bumpAnswerCacheVersion`).
 *
 * Cùng quyền `chatbot_knowledge.delete` với xoá từng hàng: nghiệp vụ y hệt, chỉ khác
 * phạm vi — tách quyền riêng sẽ tạo một vai trò "được xoá tất cả nhưng không được xoá
 * một" mà không ai cần.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')

  const removed = await clearAnswerCache(adminUser.id ?? null, event.context.requestId ?? null)
  logInfo({ event: 'chatbot.answer_cache_cleared', count: removed, adminUserId: adminUser.id ?? null })

  return { ok: true, deleted: removed }
})
