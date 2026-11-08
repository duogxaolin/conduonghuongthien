/**
 * Dọn upload bỏ dở ngay — kích hoạt `housekeepUploads` thủ công.
 *
 * `housekeepUploads` (`server/services/chunked-upload-session.ts`, xuất lại qua
 * barrel `chunked-upload.ts`) vốn do bộ đếm lịch
 * chạy nền (tick 15 phút). Nút này cho cán bộ chạy lượt dọn ngay khi muốn — ví dụ
 * sau khi đổi `sessionInactivityHours` từ 12 sang 2, muốn dọn ngay phần cũ còn
 * nằm trên đĩa thay vì chờ tick kế tiếp.
 *
 * Khoá MySQL `cdkt:media:housekeep` (timeout 0 — không xếp hàng) để nút + bộ
 * đếm lịch + cron không xoá trùng cùng một lúc — giữ ở service
 * `housekeepUploadsUnderLock` (admin-media-portal-uploads.ts) cùng pool và cấu hình
 * media. Giữ lại như data-retention "Dọn ngay": ai đến sau thấy khoá đang giữ thì
 * trả 409 thay vì báo thành công với 0 bản ghi (đọc thành "không có gì để xoá" là sai).
 *
 * Audit (`housekeep_uploads`) ghi **trong service** `housekeepUploads`, không ở
 * endpoint — service là ranh giới dữ liệu và guard `media-portal-audit` kỳ vọng
 * endpoint delegate cho service. Endpoint chỉ kiểm quyền + xác nhận + gọi service.
 */
import { createError, defineEventHandler, readBody } from 'h3'

import { requireResourcePermission } from '../../../../utils/permissions'
import { housekeepUploadsUnderLock } from '../../../../services/admin-media-portal-uploads'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media_portal', 'update')

  // Body tuỳ chọn — `confirm: true` để chống bấm nhầm, như data-retention "Dọn
  // ngay". Trống hoặc thiếu `confirm` thì trả 400.
  const body = await readBody(event).catch(() => ({}))
  const confirm = body && typeof body === 'object' && (body as Record<string, unknown>).confirm === true
  if (!confirm) {
    throw createError({ statusCode: 400, statusMessage: 'Cần xác nhận `confirm: true` để dọn ngay.' })
  }

  // `null` = không có pool: chưa đọc gì, chưa dọn gì.
  const outcome = await housekeepUploadsUnderLock(adminUser.id)
  if (!outcome) {
    throw createError({ statusCode: 503, statusMessage: 'Cơ sở dữ liệu chưa sẵn sàng.' })
  }

  // Đổi `acquired: false` thành 409 để nơi gọi đọc thành "đang bận" chứ không
  // phải "không có gì để xoá".
  if (!outcome.acquired) {
    throw createError({ statusCode: 409, statusMessage: 'Một lượt dọn khác đang chạy. Thử lại sau.' })
  }

  const result = outcome.value

  return {
    ok:       true,
    sessions: result.sessions,
    orphans:  result.orphans,
  }
})
