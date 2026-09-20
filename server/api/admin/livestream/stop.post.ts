/**
 * Dừng một buổi phát trực tiếp.
 *
 * `stopLivestream` không cần khoá — buổi phát đã đang chạy, nên không có bất biến
 * nào để giữ, và bắt cán bộ chờ khoá đúng lúc họ cần dừng khẩn cấp là đánh đổi sai.
 *
 * Service trả bốn trường hợp, mỗi cái một `statusCode` riêng:
 *   - `404`: buổi phát không tồn tại (đọc `id` từ thân, không tìm thấy hàng).
 *   - `409`: buổi đó **đã dừng rồi** — `affectedRows = 0` nhưng hàng có tồn tại.
 *     Đúng nội dung `409 Conflict`: yêu cầu xung đột với trạng thái hiện tại.
 *   - `400`: id không phải số an toàn. Đây là kiểm đầu, không cần đụng CSDL.
 *   - `200` + `{ ok: true, sessionId }`: dừng thành công.
 *
 * `id` đi qua thân request (`{ sessionId }`), không qua path — vì "dừng buổi nào"
 * là một câu nghiệp vụ, và path-param `/:id` là câu về tài nguyên. Một post không
 * có `sessionId` → 400 trước khi chạm service (controller có thẩm quyền parse
 *不好的 thân), service vẫn có sẵn `Number.isSafeInteger` như chốt thứ hai.
 */
import { defineEventHandler, readBody } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { stopLivestream } from '../../../services/livestream'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'livestream', 'update')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const sessionId = (body as Record<string, unknown>).sessionId
  if (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Buổi phát không hợp lệ.' })
  }

  const result = await stopLivestream({
    sessionId: Number(sessionId),
    actorId:   adminUser.id,
  })

  if (!result.ok) {
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  return { ok: true, sessionId: result.sessionId }
})
