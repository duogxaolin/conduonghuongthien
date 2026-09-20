/**
 * Khởi tạo một lượt tải lên video theo phần.
 *
 * `initUpload` đã kiểm tra trần dung lượng máy chủ **trước** khi ghi hàng và tạo
 * thư mục — từ chối sau khi đã ghi là một hàng rác cho mỗi lượt thử quá cỡ. Nó cũng
 * kiểm công tắc nhận video ở máy chủ, không chỉ ở giao diện: công tắc chỉ ẩn nút
 * là công tắc trang trí.
 *
 * Endpoint chỉ kiểm quyền, truyền body xuống service, và ánh xạ `UploadFailure`
 * thành `createError` với đúng `statusCode` mà service quyết định — không bọc 500:
 * 503 cho `upload_disabled`, 413 cho `size_limit`. Một 500 cho "máy chủ không nhận
 * video" làm cô giáo tưởng cổng đang hỏng khi đúng ra là máy chủ意识地 từ chối.
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { initUpload } from '../../../../services/chunked-upload'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const result = await initUpload({
    adminUserId:  adminUser.id,
    filename:     (body as Record<string, unknown>).filename,
    declaredSize: (body as Record<string, unknown>).declaredSize,
  })

  if (!result.ok) {
    throw createError({ statusCode: result.status, statusMessage: result.message })
  }

  setResponseStatus(event, 201)
  return {
    ok:         true,
    uploadId:   result.uploadId,
    chunkSize:  result.chunkSize,
    totalChunks: result.totalChunks,
    declaredSize: result.declaredSize,
  }
})
