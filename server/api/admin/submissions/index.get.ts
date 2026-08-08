import { createError } from 'h3'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { submissions, users } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { countSubmissionsByStatus } from '../../../services/submission-workflow'
import { isSubmissionStatus, type SubmissionStatus } from '../../../../app/utils/submission-status'

/**
 * Danh sách đơn đăng ký, kèm trạng thái xử lý và số đếm theo trạng thái.
 *
 * Hai bộ lọc chạy **phía máy chủ** (`status`, `viewed`), phần tìm kiếm theo tên /
 * số điện thoại vẫn chạy phía client như trước. Sự pha trộn đó là chủ đích: bộ lọc
 * quyết định *tập* bản ghi nên nó phải là thẩm quyền của máy chủ, còn ô tìm kiếm
 * chỉ thu hẹp thứ đang hiển thị.
 *
 * **Giá trị lạ bị TỪ CHỐI, không suy diễn** — cùng quy tắc bộ lọc `quick=` ở
 * `/admin/chatbot/knowledge`. `?status=xong` đọc thành `resolved` sẽ hiện một danh
 * sách đã lọc trong khi ô chọn trên màn hình vẫn ghi "Tất cả", và cán bộ kết luận
 * cổng đã mất đơn. Khác trang công khai (`/qa-documents` trả trang rỗng cho chủ đề
 * lạ vì URL ở đó chia sẻ được và một liên kết cũ báo lỗi đọc ra là cổng bị hỏng) —
 * ở đây URL do chính giao diện dựng, nên một giá trị lạ là lỗi lập trình.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'submissions', 'read')

  const query = getQuery(event)

  // Thu hẹp kiểu bằng chính hàm canh (`isSubmissionStatus` là type guard) thay vì
  // ép kiểu ở chỗ gọi `eq()`: cột `status` khai `$type<SubmissionStatus>()`, nên
  // một phép ép kiểu ở đây sẽ **khẳng định** giá trị hợp lệ chứ không **kiểm** nó
  // — đúng cấu trúc mà CLAUDE.md ghi là đã che giấu lỗi sáu lần.
  const rawStatus = String(query.status ?? '').trim()
  let statusFilter: SubmissionStatus | null = null
  if (rawStatus) {
    if (!isSubmissionStatus(rawStatus)) {
      throw createError({ statusCode: 400, statusMessage: 'Trạng thái lọc không hợp lệ.' })
    }
    statusFilter = rawStatus
  }

  const viewedFilter = String(query.viewed ?? '').trim()
  if (viewedFilter && viewedFilter !== 'yes' && viewedFilter !== 'no') {
    throw createError({ statusCode: 400, statusMessage: 'Bộ lọc lượt xem không hợp lệ.' })
  }

  const conditions = []
  if (statusFilter) conditions.push(eq(submissions.status, statusFilter))
  if (viewedFilter === 'yes') conditions.push(isNotNull(submissions.firstViewedAt))
  if (viewedFilter === 'no') conditions.push(isNull(submissions.firstViewedAt))

  const db = getDb()
  const rows = await db
    .select({
      id: submissions.id,
      fullName: submissions.fullName,
      phone: submissions.phone,
      email: submissions.email,
      address: submissions.address,
      message: submissions.message,
      answers: submissions.answers,
      formTitle: submissions.formTitle,
      status: submissions.status,
      statusChangedAt: submissions.statusChangedAt,
      // leftJoin để đơn do một tài khoản ĐÃ XOÁ đổi trạng thái vẫn đọc được — mất
      // tên người thực hiện thì cột đó còn lại một khoảng trống không giải thích.
      statusChangedByName: users.username,
      firstViewedAt: submissions.firstViewedAt,
      notifiedAt: submissions.notifiedAt,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .leftJoin(users, eq(users.id, submissions.statusChangedBy))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(submissions.createdAt))

  // Số đếm lấy trên **toàn bộ** bảng, không theo bộ lọc đang áp. Dải ô tổng trả
  // lời "tồn đọng đang thế nào"; đếm theo tập đã lọc thì chọn "Đã xử lý xong" làm
  // con số "Mới tiếp nhận" tụt về 0 — cán bộ ẩn một nhóm khỏi mắt mình rồi kết
  // luận hết việc, và **cả hai con số đều trông hợp lý**. Cùng lý do ô tổng bảng
  // NOC đọc danh sách đầy đủ chứ không đọc danh sách đã lọc.
  const counts = await countSubmissionsByStatus()

  return { ok: true, submissions: rows, counts }
})
