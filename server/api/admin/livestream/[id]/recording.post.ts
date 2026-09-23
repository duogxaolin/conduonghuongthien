/**
 * Lưu một buổi phát đã dừng thành một mục media trong thư viện.
 *
 * ## Vì sao `[id]` ở path chứ không phải trong thân
 *
 * Ba endpoint livestream kia (`start`, `stop`, `remove-chat`) đều đọc mã từ thân —
 * câu nghiệp vụ của chúng là "với buổi nào". Endpoint này là câu về một tài
 * nguyên cụ thể: "chuyển **buổi phát này** thành bản ghi". Path-param `:id` là
 * cách REST diễn đạt "tài nguyên nào", và vẫn đồng bộ với `DELETE` và `GET` nếu
 * sau này thêm.
 *
 * ## Ba nhánh từ chối, mỗi nhánh một `statusCode`
 *
 * `saveSessionAsRecording` đã bọc toàn bộ trong `db.transaction`, và `createMediaItem`
 * được gọi với `{ db: tx }` — hàng `media_items`, dòng audit của nó, cột
 * `saved_media_id` trỏ ngược, và dòng audit của phiên cùng sống hoặc cùng chết.
 *
 * Service trả:
 *   - `404`: phiên không tồn tại.
 *   - `409`: phiên **đang chạy** — phải dừng trước khi lưu. Cũng `409` nếu phiên
 *     **đã được lưu** — một cú bấm đúp sẽ sinh thêm một bản nháp trùng mà không ai
 *     xoá, còn bản đầu mất liên kết duy nhất trỏ tới nó. Cả hai đều là `409 Conflict`
 *     về bản chất: yêu cầu xung đột với trạng thái hiện tại.
 *   - `400`: `sessionId` không hợp lệ.
 *   - `201` + `{ ok: true, mediaItemId, slug }`: lưu thành công.
 *
 * ## RBAC kiểm HAI tài nguyên
 *
 * Lưu bản ghi vừa sửa phiên livestream (`livestream/update`) vừa tạo một mục
 * media mới (`media_portal/create` через `createMediaItem`) — nên endpoint
 * kiểm **cả hai** quyền. Thiếu quyền `media_portal/create` mà chỉ có
 * `livestream/update` sẽ cho phép tạo bản ghi thư viện qua đường livestream
 * — lách qua RBAC của Media Portal.
 */
import { defineEventHandler, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { saveSessionAsRecording } from '../../../../services/livestream'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  // Lưu một buổi phát thành bản ghi là **hai** thao tác nghiệp vụ trên **hai**
  // tài nguyên khác nhau: (1) sửa phiên livestream (`livestream/update` — gắn
  // `saved_media_id`), và (2) tạo một mục media mới trong thư viện
  // (`media_portal/create` — `createMediaItem` chèn hàng `media_items`). Chỉ
  // check `livestream/update` sẽ cho phép một cán bộ được phát trực tiếp nhưng
  // **không** được tải media lên thư viện tạo bản ghi mp4 — đúng cách lách qua
  // RBAC của media portal. Cùng tiền lệ với `articles/[id].put.ts` kiểm lần
  // thứ hai khi bài đổi thể loại: quyền phải khớp **kết quả** của thao tác, không
  // chỉ intent ban đầu.
  requireResourcePermission(adminUser, 'livestream', 'update')
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const sessionId = Number(event.context.params?.id)
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Buổi phát không hợp lệ.' })
  }

  const result = await saveSessionAsRecording({
    sessionId,
    actorId: adminUser.id,
  })

  if (!result.ok) {
    throw createError({ statusCode: result.statusCode, statusMessage: result.message })
  }

  setResponseStatus(event, 201)
  return {
    ok:          true,
    mediaItemId: result.mediaItemId,
    slug:        result.slug,
  }
})
