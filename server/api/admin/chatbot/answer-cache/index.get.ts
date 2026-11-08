import { requireResourcePermission } from '../../../../utils/permissions'
import { listAnswerCache } from '../../../../services/chatbot-answer-cache'
import { auditAnswerCacheListRead } from '../../../../services/admin-chatbot-answer-cache-list-audit'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100
const MAX_SEARCH = 200

/**
 * Danh sách câu trả lời đã cache.
 *
 * Quyền dùng `chatbot_knowledge.read` như mọi trang quản trị chatbot khác — người đã
 * được đọc kho tri thức thì cũng được xem cái đang được phát lại cho người dân, và
 * không có lý do tạo resource mới cho một bảng phụ.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'read')

  const query = getQuery(event)
  const page = Math.trunc(Number(query.page ?? 1))
  const pageSize = Math.trunc(Number(query.pageSize ?? DEFAULT_PAGE_SIZE))
  if (!Number.isFinite(page) || page < 1) throw createError({ statusCode: 400, statusMessage: 'Trang không hợp lệ.' })
  if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw createError({ statusCode: 400, statusMessage: `Số dòng mỗi trang phải từ 1 đến ${MAX_PAGE_SIZE}.` })
  }
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, MAX_SEARCH) : ''

  const { items, total } = await listAnswerCache(page, pageSize, search)

  // Một dòng audit mỗi lượt ĐỌC, không phải mỗi hàng hiển thị (cùng khuôn với
  // `chatbot/sessions/index.get.ts`): người xem danh sách, không phải người sửa dữ liệu.
  // Best-effort: a failed insert is swallowed (services/admin-chatbot-answer-cache-list-audit.ts).
  await auditAnswerCacheListRead(adminUser, { page, pageSize, search, total })

  return {
    ok: true,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items,
  }
})
