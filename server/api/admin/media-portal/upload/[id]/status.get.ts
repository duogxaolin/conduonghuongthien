/**
 * Trạng thái một lượt tải lên — phần nào đã nhận, phần nào còn thiếu.
 *
 * Đây là thao tác làm cho "tiếp tục sau khi mạng đứt" khả thi: client biết phần
 * nào gửi tiếp thay vì bắt đầu lại từ đầu. Không `finitePositive` ở đây: `uploadId`
 * là UUID do máy chủ sinh, không phải số trang — service tự kiểm hình dạng qua
 * `isValidUploadId`.
 *
 * `UploadSessionView` có sẵn `status` và `errorMessage` để giao diện phân biệt
 * "đang dở", "hỏng", và "xong rồi" — service trả đủ cả bản view lẫn mảng
 * `missing` trong cùng một đối tượng.
 */
import { defineEventHandler } from 'h3'

import { requireResourcePermission } from '../../../../../utils/permissions'
import { uploadStatus } from '../../../../../services/chunked-upload'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'read')

  const uploadId = event.context.params?.id

  const result = await uploadStatus({
    adminUserId: adminUser.id,
    uploadId,
  })

  if (!result.ok) {
    throw createError({ statusCode: result.status, statusMessage: result.message })
  }

  return {
    ok:      true,
    session: result.session,
    missing: result.missing,
  }
})
