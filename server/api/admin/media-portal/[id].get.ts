/**
 * Chi tiết một mục media cho quản trị viên.
 *
 * Trả đủ các trường đường công khai loại ra: `status`, `processingError`,
 * `storagePath`, `isFeatured`. Đây là endpoint mà task 7.6 cần — một mục
 * `failed` phải hiện cùng lý do để cán bộ biết vì sao nó không phát được, thay vì
 * biến một lỗi xử lý thành "không có mục nào".
 *
 * Id không tồn tại → 404, không trả null kèm 200: một 200 mang `null` là một hợp
 * đồng khó dùng ở giao diện — component phải đoán `null` có nghĩa là "chưa tải"
 * hay "không tồn tại", và đoán sai một trong hai.
 */
import { defineEventHandler } from 'h3'

import { requireResourcePermission } from '../../../utils/permissions'
import { getMediaItemForAdmin } from '../../../services/media-portal'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'read')

  const id = Number(event.context.params?.id)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mục media không hợp lệ.' })
  }

  const item = await getMediaItemForAdmin(Math.floor(id))
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Mục media không tồn tại.' })
  }

  return { ok: true, item }
})
