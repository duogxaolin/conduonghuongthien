import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { submissions, users } from '../../../../db/schema'
import { listSubmissionEvents, recordSubmissionView } from '../../../../services/submission-workflow'

/**
 * Một đơn đăng ký kèm nhật ký xử lý của nó.
 *
 * Lượt GET này **ghi**: nó đóng dấu "đã có người xem" và thêm một dòng
 * `activity_logs`. Đó là tiền lệ sẵn có của dự án cho dữ liệu công dân —
 * `/admin/chatbot/sessions/[id]` làm đúng vậy, vì một nhật ký dữ liệu công dân
 * quét được trong im lặng là công cụ theo dõi, không phải nhật ký kiểm toán.
 *
 * Khác trường hợp `activity-logs/retention.get.ts` (nơi CLAUDE.md cấm hẳn việc
 * ghi trong GET): ở đó lượt ghi là **xoá**, nên một cú F5 làm mất dữ liệu. Ở đây
 * lượt ghi là **thêm**, và phần đóng dấu chỉ nhận lượt đầu (`first_viewed_at IS
 * NULL` nằm trong câu UPDATE), nên bấm F5 mười lần vẫn ra đúng một kết quả.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Mã đơn đăng ký không hợp lệ.' })
  }

  // Kiểm quyền + đóng dấu lượt xem nằm trong service (đúng một transaction cho
  // cặp ghi + audit). Nó cũng ném 404 nếu đơn không tồn tại, nên phần đọc bên
  // dưới không phải kiểm lại.
  const { firstView } = await recordSubmissionView(event.context.adminUser, id)

  const db = getDb()
  const [row] = await db
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
      // leftJoin để đơn do một tài khoản ĐÃ XOÁ đổi trạng thái vẫn đọc được —
      // mất tên người thực hiện thì dòng thời gian còn lại một khoảng trống.
      statusChangedByName: users.username,
      firstViewedAt: submissions.firstViewedAt,
      notifiedAt: submissions.notifiedAt,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .leftJoin(users, eq(users.id, submissions.statusChangedBy))
    .where(eq(submissions.id, id))
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: 'Đơn đăng ký không tồn tại.' })

  const events = await listSubmissionEvents(id)
  return { ok: true, submission: row, events, firstView }
})
