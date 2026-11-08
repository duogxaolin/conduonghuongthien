import { z } from 'zod'
import { getClientIp } from '../../../../utils/client-ip'
import { requireResourcePermission } from '../../../../utils/permissions'
import { readValidated } from '../../../../utils/request-body'
import { bulkDeleteCachedAnswersWithAudit } from '../../../../services/admin-chatbot-answer-cache-admin'

const MAX_IDS = 200

/**
 * Xoá NHIỀU câu trả lời đã cache trong một transaction, kèm audit.
 *
 * Trần 200 id (cao hơn 100 của xoá phiên chat vì mỗi hàng cache nhẹ hơn nhiều), và chỉ
 * những id THỰC SỰ bị xoá mới vào `count` — id gửi hai lần hay id không tồn tại không
 * phải là một lần xoá.
 *
 * Body đọc qua `readValidated` (wave2 D5): `readBody(event).catch(() => null)` biến một
 * body bị cắt cụt thành "không gửi gì" và endpoint chạy trên dữ liệu rỗng. Ở đây khoá
 * không phải hex 64 ký tự bị TỪ CHỐI chứ không lặng lẽ bỏ đi: im lặng bỏ một khoá là
 * cách để người bấm "Xoá" tưởng đã xoá trong khi câu trả lời vẫn được phát lại.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'chatbot_knowledge', 'delete')

  const body = await readValidated(event, z.object({
    keys: z.array(z.string().regex(/^[0-9a-f]{64}$/u, 'Mã cache phải là 64 ký tự hex.'), {
      error: 'Vui lòng chọn ít nhất 1 câu trả lời để xoá.',
    }).min(1, 'Vui lòng chọn ít nhất 1 câu trả lời để xoá.'),
  }))
  const keys = [...new Set(body.keys)]
  if (keys.length > MAX_IDS) throw createError({ statusCode: 400, statusMessage: `Tối đa ${MAX_IDS} câu trả lời mỗi lượt.` })

  // The rows and one audit row in one transaction; only rows actually deleted count (services/admin-chatbot-answer-cache-admin.ts).
  const removed = await bulkDeleteCachedAnswersWithAudit(adminUser, keys, getClientIp(event))

  return { ok: true, deleted: removed }
})
