import { listKnowledge, adminKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  requireChatbotKnowledgePermission(event, 'read')
  const query = getQuery(event)
  try {
    const result = await listKnowledge({ page: Number(query.page || 1), perPage: Number(query.perPage || 20), search: String(query.search || ''), topic: String(query.topic || ''), status: String(query.status || ''), quick: String(query.quick || '') })
    /**
     * `.filter(...)` lọc null với một type guard, không phải để phòng thân.
     *
     * `adminKnowledge()` khai trả `T | null` vì nó dùng chung với đường đọc một
     * bản ghi (nơi id không tồn tại là chuyện thường). Nhưng `listKnowledge()`
     * chỉ trả những hàng nó vừa đọc được, nên nhánh null ở đây **không bao giờ
     * xảy ra** — và một kiểu khai `null` cho thứ không bao giờ null bắt mọi nơi
     * gọi phải kiểm một điều kiện chết. Lọc ở đây khiến kiểu nói đúng sự thật
     * thay vì đẩy một lời nói dối sang trang quản trị.
     */
    const items = result.items
      .map(item => adminKnowledge(item))
      .filter((item): item is NonNullable<typeof item> => item !== null)
    return { ok: true, items, pagination: result.pagination }
  } catch (error) { if (error instanceof ChatbotKnowledgeValidationError) throw createError({ statusCode: 400, statusMessage: error.message }); throw error }
})
