/**
 * Đăng ký một video nguồn ngoài làm mục media.
 *
 * ## Vì sao tách route này khỏi `index.post.ts`
 *
 * Tạo một mục `source: 'upload'` đi qua quy trình tải lên từng phần
 * (`initUpload` → `receiveChunk` × N → `completeUpload`) và kết thúc bằng một
 * hàng `media_items` có `storage_path`. Một mục `source: 'youtube'` không có
 * tệp để tải lên: nó chỉ cần một định danh video, và `createMediaItem` sẵn sàng
 * ngay (`processingStatus: 'ready'` cho mục nguồn ngoài — xem service).
 *
 * Trộn hai đường vào một endpoint buộc phải phân nhánh theo `source` ở phần
 * đầu handler, và mỗi nhánh là một logic khác hẳn. Tách route giữ cho mỗi handler
 * đọc một dòng là biết nó phục vụ loại nào.
 *
 * ## Định danh video phải bóc được
 *
 * `createMediaItem` đã bóc định danh qua `extractYouTubeVideoId` và ném
 * `MediaValidationError` khi giá trị không nhận ra được. Endpoint này **không tự
 * kiểm**: để service là thẩm quyền, và thông báo lỗi của service đi thẳng vào
 * phản hồi. Một endpoint có thông báo "địa chỉ không hợp lệ" thứ hai là một chỗ
 * thứ hai để một ngày nào đó nói một điều khác với service.
 *
 * Trả 201 + `{ ok, id, slug }` khi thành công. `MediaValidationError` → 400 (lỗi
 * kiểm dữ liệu cụ thể, không phải 500)
 */
import { defineEventHandler, readBody, setResponseStatus } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { MediaValidationError, createMediaItem } from '../../../services/media-portal'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'create')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const fields = body as Record<string, unknown>

  try {
    const result = await createMediaItem({
      title:          fields.title,
      description:    fields.description,
      source:         'youtube',
      youtubeVideoId: fields.youtubeVideoId ?? fields.youtubeUrl ?? fields.url,
      categoryId:     fields.categoryId,
      createdBy:      adminUser.id,
    })

    setResponseStatus(event, 201)
    return { ok: true, id: result.mediaItemId, slug: result.slug, shortId: result.shortId }
  } catch (error) {
    if (error instanceof MediaValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
