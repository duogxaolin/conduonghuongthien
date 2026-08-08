/**
 * Vòng đời xử lý một đơn đăng ký: xem, đổi trạng thái, ghi chú, ghi nhận đã liên
 * hệ người dân.
 *
 * Nằm ở `services/` chứ không viết thẳng trong handler vì **cả bốn** đường ghi đều
 * chạm hai bảng cùng lúc (hàng đơn hoặc `submission_events`, **cộng** một dòng
 * `activity_logs`), và quy ước của dự án nói cặp đó phải commit trong **một**
 * transaction. Xem "Đường ghi audit" trong CLAUDE.md: ghi rời là để một lượt lỗi
 * để lại một nhật ký khai một việc chưa xảy ra, hoặc một việc đã xảy ra mà không
 * có gì ghi lại.
 *
 * `activity_logs` cố ý **không** chở theo họ tên / số điện thoại / địa chỉ của
 * người dân — chỉ `resourceId` và phần siêu dữ liệu về chính hành vi. Chép thông
 * tin cá nhân sang đó là để lại đúng dữ liệu đó ở một bảng thứ hai, và làm lượt
 * xoá đơn ở `deleteSubmissionById` mất tác dụng.
 */
import { createError } from 'h3'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, submissionEvents, submissions, users } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'
// Phép đọc `affectedRows` đi qua helper dùng chung, không bao giờ tự ép kiểu:
// `as { affectedRows?: number }` **khẳng định** hình dạng chứ không **kiểm** nó,
// và dự án đã trả giá sáu lần cho đúng cấu trúc đó (xem CLAUDE.md).
import { affectedRowsOrZero } from '../utils/affected-rows'
import { hasForbiddenControlChars } from '../utils/plain-text'
import {
  DEFAULT_SUBMISSION_STATUS,
  SUBMISSION_NOTE_MAX,
  canTransition,
  isContactChannel,
  isSubmissionStatus,
  type ContactChannel,
  type SubmissionStatus,
} from '../../app/utils/submission-status'

export interface SubmissionEventRow {
  id: number
  actorId: number | null
  actorName: string | null
  actorUsername: string | null
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  channel: string | null
  note: string | null
  createdAt: Date | null
}

/** Tên hiện trong nhật ký: ảnh chụp lúc đó, lùi về tài khoản còn sống. */
function actorLabel(actor: ActorLike): string {
  const named = actor as { username?: unknown }
  return String(named.username || '').trim().slice(0, 64) || `#${actor.id}`
}

async function loadSubmission(id: number): Promise<{ id: number; status: SubmissionStatus; firstViewedAt: Date | null }> {
  const db = getDb()
  const [row] = await db
    .select({ id: submissions.id, status: submissions.status, firstViewedAt: submissions.firstViewedAt })
    .from(submissions)
    .where(eq(submissions.id, id))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Đơn đăng ký không tồn tại.' })
  // Hàng cũ có `status` rỗng (trước khi cột tồn tại) đọc về mặc định thay vì ném:
  // một giá trị lạ trong CSDL không nên làm trang quản trị mở không được.
  return { ...row, status: isSubmissionStatus(row.status) ? row.status : DEFAULT_SUBMISSION_STATUS }
}

/** Nhật ký xử lý của một đơn, cũ nhất trước — đọc như một dòng thời gian. */
export async function listSubmissionEvents(id: number): Promise<SubmissionEventRow[]> {
  const db = getDb()
  return db
    .select({
      id: submissionEvents.id,
      actorId: submissionEvents.actorId,
      actorName: submissionEvents.actorName,
      // leftJoin để hàng của một tài khoản ĐÃ XOÁ vẫn còn — đó là dấu vết cần giữ
      // nhất. `actorName` là ảnh chụp nên nhật ký vẫn đọc được là ai.
      actorUsername: users.username,
      eventType: submissionEvents.eventType,
      fromStatus: submissionEvents.fromStatus,
      toStatus: submissionEvents.toStatus,
      channel: submissionEvents.channel,
      note: submissionEvents.note,
      createdAt: submissionEvents.createdAt,
    })
    .from(submissionEvents)
    .leftJoin(users, eq(users.id, submissionEvents.actorId))
    .where(eq(submissionEvents.submissionId, id))
    .orderBy(submissionEvents.createdAt, submissionEvents.id)
}

/**
 * Đánh dấu một đơn là **đã có người xem**, và ghi ai xem lần đầu.
 *
 * Chỉ ghi khi `first_viewed_at IS NULL`, và điều kiện đó nằm **trong câu UPDATE**
 * chứ không phải một lượt SELECT trước đó: đọc-rồi-ghi thì hai cán bộ mở cùng lúc
 * đều thấy NULL và người sau ghi đè lên người trước — sai đúng cái mà cột này
 * tồn tại để trả lời. `affectedRows` là thẩm quyền quyết định "mình là người đầu".
 *
 * KHÔNG tự đổi trạng thái sang `in_progress`. Mở một hồ sơ ra đọc không phải là
 * nhận xử lý nó, và tự chuyển sẽ làm mọi đơn rời khỏi ô "Mới tiếp nhận" chỉ vì có
 * ai đó bấm vào xem — bộ lọc đó sẽ vĩnh viễn rỗng và không còn nói lên điều gì.
 */
export async function recordSubmissionView(actor: ActorLike, id: number): Promise<{ firstView: boolean }> {
  requireResourcePermission(actor, 'submissions', 'read')
  await loadSubmission(id)

  const db = getDb()
  const now = new Date()
  const label = actorLabel(actor)

  return db.transaction(async (tx) => {
    const [header] = await tx
      .update(submissions)
      .set({ firstViewedBy: actor.id, firstViewedAt: now })
      .where(and(eq(submissions.id, id), isNull(submissions.firstViewedAt)))

    const firstView = affectedRowsOrZero(header) > 0

    // Mọi lượt xem đi vào `activity_logs` — đây là hồ sơ liên hệ của một công dân,
    // và một nhật ký dữ liệu công dân quét được trong im lặng là công cụ theo dõi.
    // Chỉ lượt ĐẦU vào `submission_events`: dòng thời gian của hồ sơ trả lời "đã có
    // ai nhìn tới chưa", và một mục "đã xem" cho mỗi lần bấm F5 sẽ dìm chết đúng
    // những mục có nội dung.
    if (firstView) {
      await tx.insert(submissionEvents).values({
        submissionId: id,
        actorId: actor.id,
        actorName: label,
        eventType: 'view',
        createdAt: now,
      })
    }

    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'read',
      resource: 'submissions',
      resourceId: id,
      meta: { firstView },
    })

    return { firstView }
  })
}

export interface StatusChangeInput {
  status: unknown
  note?: unknown
}

/**
 * Đổi trạng thái xử lý.
 *
 * Phép kiểm chuyển tiếp dùng `canTransition` — cùng hàm giao diện dùng để dựng
 * danh sách lựa chọn, nên một trạng thái hiện ra trên màn hình luôn là một trạng
 * thái máy chủ sẽ nhận. Đổi sang **chính trạng thái đang có** bị từ chối: nó
 * không đổi gì mà vẫn sinh một mục trong nhật ký, và một dòng thời gian đầy những
 * mục không đổi gì là một dòng thời gian không ai đọc.
 */
export async function changeSubmissionStatus(actor: ActorLike, id: number, input: StatusChangeInput): Promise<{ status: SubmissionStatus }> {
  requireResourcePermission(actor, 'submissions', 'update')

  const next = input.status
  if (!isSubmissionStatus(next)) {
    throw createError({ statusCode: 400, statusMessage: 'Trạng thái xử lý không hợp lệ.' })
  }
  const note = normalizeNote(input.note)

  const current = await loadSubmission(id)
  if (current.status === next) {
    throw createError({ statusCode: 400, statusMessage: 'Đơn đã ở trạng thái này.' })
  }
  if (!canTransition(current.status, next)) {
    throw createError({ statusCode: 400, statusMessage: 'Không thể chuyển sang trạng thái này.' })
  }

  const db = getDb()
  const now = new Date()
  const label = actorLabel(actor)

  await db.transaction(async (tx) => {
    await tx
      .update(submissions)
      .set({ status: next, statusChangedBy: actor.id, statusChangedAt: now })
      .where(eq(submissions.id, id))

    await tx.insert(submissionEvents).values({
      submissionId: id,
      actorId: actor.id,
      actorName: label,
      eventType: 'status',
      fromStatus: current.status,
      toStatus: next,
      note,
      createdAt: now,
    })

    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'submissions',
      resourceId: id,
      // Giá trị trước/sau: "ai đã đóng hồ sơ này, từ trạng thái nào" đúng là câu
      // hỏi nhật ký phải trả lời được về chính nó.
      meta: { field: 'status', from: current.status, to: next, hasNote: Boolean(note) },
    })
  })

  return { status: next }
}

function normalizeNote(raw: unknown): string | null {
  const value = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!value) return null
  if (value.length > SUBMISSION_NOTE_MAX) {
    // Từ chối kèm nêu rõ giới hạn, không cắt ngầm — một cán bộ bị mất đoạn cuối
    // ghi chú nghiệp vụ không có cách nào biết là mình đã mất.
    throw createError({ statusCode: 400, statusMessage: `Ghi chú quá dài (tối đa ${SUBMISSION_NOTE_MAX} ký tự).` })
  }
  // Ký tự điều khiển ngoài `\n` và `\t` bị từ chối — cùng quy tắc nội dung bình luận.
  if (hasForbiddenControlChars(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Ghi chú chứa ký tự không hợp lệ.' })
  }
  return value
}

/** Ghi một ghi chú nghiệp vụ, không đổi trạng thái. */
export async function addSubmissionNote(actor: ActorLike, id: number, rawNote: unknown): Promise<void> {
  requireResourcePermission(actor, 'submissions', 'update')

  const note = normalizeNote(rawNote)
  if (!note) throw createError({ statusCode: 400, statusMessage: 'Vui lòng nhập nội dung ghi chú.' })

  await loadSubmission(id)

  const db = getDb()
  const now = new Date()
  const label = actorLabel(actor)

  await db.transaction(async (tx) => {
    await tx.insert(submissionEvents).values({
      submissionId: id,
      actorId: actor.id,
      actorName: label,
      eventType: 'note',
      note,
      createdAt: now,
    })
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'submissions',
      resourceId: id,
      // Chỉ ghi ĐỘ DÀI, không ghi nội dung: ghi chú nghiệp vụ nói về hoàn cảnh của
      // một công dân, và chép nó sang bảng thứ hai là nhân đôi dữ liệu cần xoá.
      meta: { field: 'note', noteLength: note.length },
    })
  })
}

export interface ContactLogInput {
  channel: unknown
  note?: unknown
}

/**
 * Ghi nhận **đã liên hệ người dân**.
 *
 * Tách khỏi `note` vì đó là hai câu hỏi khác nhau. "Đã gọi cho người này chưa" là
 * câu cán bộ trực phải trả lời được trong vài giây, và nếu nó chỉ nằm trong lời văn
 * của ghi chú thì đáp án duy nhất là đọc hết mọi ghi chú của mọi đơn.
 *
 * KHÔNG tự đổi trạng thái. Gọi điện xong có thể là "đang xử lý", có thể là "đã
 * chuyển cơ sở", có thể là "không tiếp nhận" — đoán hộ là ghi một kết luận nghiệp
 * vụ mà cán bộ chưa đưa ra.
 */
export async function logSubmissionContact(actor: ActorLike, id: number, input: ContactLogInput): Promise<void> {
  requireResourcePermission(actor, 'submissions', 'update')

  if (!isContactChannel(input.channel)) {
    throw createError({ statusCode: 400, statusMessage: 'Hình thức liên hệ không hợp lệ.' })
  }
  const channel: ContactChannel = input.channel
  const note = normalizeNote(input.note)

  await loadSubmission(id)

  const db = getDb()
  const now = new Date()
  const label = actorLabel(actor)

  await db.transaction(async (tx) => {
    await tx.insert(submissionEvents).values({
      submissionId: id,
      actorId: actor.id,
      actorName: label,
      eventType: 'contact',
      channel,
      note,
      createdAt: now,
    })
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'submissions',
      resourceId: id,
      meta: { field: 'contact', channel, hasNote: Boolean(note) },
    })
  })
}

/** Đếm đơn theo trạng thái, cho dải ô tổng trên trang quản trị. */
export async function countSubmissionsByStatus(): Promise<Record<string, number>> {
  const db = getDb()
  const rows = await db
    .select({ status: submissions.status, total: sql<number>`COUNT(*)` })
    .from(submissions)
    .groupBy(submissions.status)
  const out: Record<string, number> = {}
  for (const row of rows) {
    const key = isSubmissionStatus(row.status) ? row.status : DEFAULT_SUBMISSION_STATUS
    out[key] = (out[key] ?? 0) + Number(row.total ?? 0)
  }
  return out
}

/** Mục nhật ký gần nhất của mỗi đơn — dùng cho cột "Lần xử lý gần nhất". */
export async function latestEventFor(id: number): Promise<SubmissionEventRow | null> {
  const db = getDb()
  const [row] = await db
    .select({
      id: submissionEvents.id,
      actorId: submissionEvents.actorId,
      actorName: submissionEvents.actorName,
      actorUsername: users.username,
      eventType: submissionEvents.eventType,
      fromStatus: submissionEvents.fromStatus,
      toStatus: submissionEvents.toStatus,
      channel: submissionEvents.channel,
      note: submissionEvents.note,
      createdAt: submissionEvents.createdAt,
    })
    .from(submissionEvents)
    .leftJoin(users, eq(users.id, submissionEvents.actorId))
    .where(eq(submissionEvents.submissionId, id))
    .orderBy(desc(submissionEvents.createdAt), desc(submissionEvents.id))
    .limit(1)
  return row ?? null
}
