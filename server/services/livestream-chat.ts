/**
 * Chat trực tiếp của một buổi phát: gửi, đọc lịch sử, và kiểm duyệt.
 *
 * ## Phiên và người gửi do MÁY CHỦ giải, không bao giờ lấy từ request
 *
 * Cả ba hàm dưới đây tự đi tìm buổi phát đang chạy, và tên người gửi được suy từ
 * danh tính đọc được ở cookie phiên. Không tham số nào của request chạm tới hai
 * thứ đó — không `sessionId`, không `displayName`. Đây không phải chuyện phòng xa:
 * nhận `sessionId` từ request là mở luôn **lịch sử chat của mọi buổi phát cũ** cho
 * bất kỳ ai đoán được một số nguyên, còn nhận tên từ request là để người gửi tự
 * chọn mình hiện ra là ai trước hàng trăm người xem.
 *
 * ## Vì sao lượt GỬI không ghi `activity_logs`, còn lượt KIỂM DUYỆT thì có
 *
 * Bản phác trong `openspec/media-portal-plan.md` vẽ lượt gửi có kèm một dòng audit.
 * Ở đây nó **không có**, và đó là chủ đích: tiền lệ đã được kiểm của chính dự án
 * này là `createComment` — bình luận của công dân **không** sinh dòng audit, còn
 * `createAdminReply` — phản hồi của cán bộ — thì có, và `createAdminReply` nằm
 * trong `AUDITED_WRITES` của `tests/reader-audit-atomicity.test.ts` còn
 * `createComment` thì không. Ranh giới là **ai đang tác động lên dữ liệu của ai**:
 * công dân viết nội dung của chính mình, cán bộ tác động lên nội dung của người
 * khác.
 *
 * Hàng `livestream_messages` **đã là** bản ghi: nó có người gửi, nội dung và thời
 * điểm. Chép nó sang `activity_logs` là để lại đúng dữ liệu đó ở một bảng thứ hai
 * — cùng lập luận mà `submission-workflow.ts` dùng khi từ chối ghi họ tên và số
 * điện thoại vào `meta`. Và với một buổi phát có hàng trăm người xem thì đó là
 * hàng nghìn dòng audit cho một buổi tối, làm loãng đúng những dòng bảng đó tồn
 * tại để ghi.
 *
 * Lượt kiểm duyệt thì ngược lại: một cán bộ vừa xoá lời của một công dân khỏi mắt
 * những người đang xem. Không có dòng audit nào ghi ai làm việc đó là đúng thứ
 * tính năng này không được phép sinh ra.
 *
 * ## Xoá là ĐÁNH DẤU, không phải xoá hàng
 *
 * `is_deleted = 1` và hàng ở lại. Cùng lý do như trên: hành động kiểm duyệt tự nó
 * phải kiểm toán được, và một hàng biến mất thì không còn gì để đối chiếu với
 * dòng audit vừa ghi.
 */
import { and, desc, eq } from 'drizzle-orm'

import { activityLogs, livestreamMessages, livestreamSessions } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { getDb, type Database } from '../utils/db'
import { effectiveDisplayName } from '../utils/display-name'
import { hasForbiddenControlChars } from '../utils/plain-text'
import { finitePositive } from '../utils/query-number'
import { rateLimitDeps } from '../utils/rate-limit-deps'
import { recordRateLimitHit, type RateLimitDeps, type RateLimitRule } from '../utils/rate-limit-store'
import { broadcastToSession, SSE_EVENT_MESSAGE, SSE_EVENT_REMOVAL } from '../utils/sse-manager'
import { checkAndModerateContent, fastPreModerate } from './moderation-worker'

/**
 * Độ dài tối đa của một tin nhắn — và nó **phải** khớp `varchar(200)` của cột
 * `livestream_messages.content`.
 *
 * Hai con số này sống ở hai tệp khác nhau và không có gì buộc chúng khớp: MySQL ở
 * chế độ mặc định (`STRICT_TRANS_TABLES`) **từ chối** câu INSERT dài hơn cột chứ
 * không cắt, nên một hằng số lớn hơn cột biến mọi tin nhắn dài thành lỗi 500 —
 * người gửi thấy ô chat của mình hỏng và không có gì chỉ vào nguyên nhân. Nhỏ hơn
 * thì chỉ là một giới hạn chặt hơn cần thiết. `tests/livestream-chat.test.ts` đối
 * chiếu hằng số này với độ dài cột khai trong `schema.ts`.
 */
export const LIVESTREAM_CHAT_MAX_LENGTH = 200

/**
 * Độ dài tối đa của tên hiển thị chụp lại — khớp `varchar(100)`.
 *
 * Khác với nội dung, tên bị **cắt** chứ không bị từ chối. `reader_accounts.display_name`
 * rộng 255 ký tự vì nó là tên Google, nên một cái tên dài hơn 100 là chuyện có
 * thật; từ chối gửi tin vì tên Google của ai đó dài quá là biến một chuyện không
 * liên quan thành một ô chat hỏng. Một cái tên cắt ở 100 ký tự vẫn chỉ ra được
 * người nói, còn một tin nhắn bị từ chối thì mất đúng thứ người ta muốn nói.
 */
export const LIVESTREAM_CHAT_NAME_MAX_LENGTH = 100

/** Mặc định và trần của một lượt đọc lịch sử. Vượt trần thì phục vụ ở mức trần. */
export const CHAT_HISTORY_DEFAULT = 50
export const CHAT_HISTORY_MAX = 200

/**
 * Hạn mức theo **tài khoản**. Chặt hơn hạn mức theo địa chỉ: một người gõ hai mươi
 * câu trong năm phút đã là một cuộc trò chuyện dày.
 */
const CHAT_READER_RULE: RateLimitRule = { limit: 20, windowSeconds: 300 }

/**
 * Hạn mức theo **địa chỉ**. Lỏng hơn vì một hộ gia đình, một cơ quan hay một trạm
 * NAT của nhà mạng đặt nhiều người không liên quan sau cùng một địa chỉ.
 */
const CHAT_IP_RULE: RateLimitRule = { limit: 50, windowSeconds: 300 }

export type LivestreamChatDeps = {
  db?: Database
  /** Điểm tiêm cho test; production đi qua `rateLimitDeps()`. */
  rateLimit?: RateLimitDeps
  /** Điểm tiêm cho kiểm duyệt an ninh. */
  moderate?: typeof checkAndModerateContent
}

/**
 * Danh tính người gửi, **hẹp có chủ đích**.
 *
 * Chỉ ba trường, và không trường nào là tên hiển thị đã giải sẵn: tên được suy ra
 * *bên trong* service bằng `effectiveDisplayName`, nên không nơi gọi nào truyền
 * được một cái tên vào. Một hàm nhận `displayName: string` là một hàm mà nơi gọi
 * thứ hai sẽ truyền `body.name`.
 */
export type ChatSender = {
  id: number
  displayName: string | null
  customDisplayName: string | null
}

/** Tin nhắn ở dạng trang công khai được thấy. Không `readerId`, không `isDeleted`. */
export type ChatMessage = {
  id: number
  displayName: string
  content: string
  createdAt: string
}

export type ContentValidation =
  | { ok: true, content: string }
  | { ok: false, message: string }

/**
 * Chuẩn hoá và chặn nội dung, cùng khuôn `validateBody` của bình luận.
 *
 * CRLF gom về LF để trình duyệt Windows và điện thoại cho ra cùng một chuỗi byte —
 * không thì cùng một câu đếm ra hai độ dài khác nhau tuỳ người ta gõ bằng gì. Ký
 * tự điều khiển bị **từ chối** chứ không bị lọc bỏ: một nội dung mang chúng hoặc
 * là lỗi dán, hoặc là một lượt dò, và lọc bỏ sẽ cho người gửi thấy một tin nhắn
 * không phải thứ họ gửi.
 *
 * Quá dài thì **từ chối kèm nêu rõ giới hạn**, không bao giờ cắt ngầm — cùng quy
 * tắc nội dung bình luận và ghi chú xử lý đơn.
 */
export function validateChatContent(raw: unknown): ContentValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Nội dung tin nhắn không hợp lệ.' }

  const normalized = raw.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { ok: false, message: 'Vui lòng nhập nội dung tin nhắn.' }

  if (hasForbiddenControlChars(normalized)) {
    return { ok: false, message: 'Nội dung tin nhắn chứa ký tự không được phép.' }
  }

  if (normalized.length > LIVESTREAM_CHAT_MAX_LENGTH) {
    return { ok: false, message: `Nội dung tin nhắn quá dài (tối đa ${LIVESTREAM_CHAT_MAX_LENGTH} ký tự).` }
  }

  return { ok: true, content: normalized }
}

/**
 * Tên hiển thị chụp vào hàng tin nhắn, đã cắt theo bề rộng cột.
 *
 * Đây là 12.9: tên được chụp **lúc gửi**, nên một lượt đổi tên sau đó không viết
 * lại được thứ hàng trăm người đã đọc.
 */
export function snapshotDisplayName(sender: ChatSender): string {
  return effectiveDisplayName({
    customDisplayName: sender.customDisplayName,
    displayName:      sender.displayName,
  }).slice(0, LIVESTREAM_CHAT_NAME_MAX_LENGTH)
}

/** Hàng đã lưu, ở dạng ra được khỏi máy chủ. */
function serializeChatMessage(row: {
  id: number
  displayName: string
  content: string
  createdAt: Date | null
}): ChatMessage {
  return {
    id:          row.id,
    displayName: row.displayName,
    content:     row.content,
    createdAt:   row.createdAt ? row.createdAt.toISOString() : '',
  }
}

export type ActiveSessionRef = { id: number, title: string }

/** Buổi phát đang chạy, chỉ hai cột — đủ để gắn một tin nhắn vào và để báo cho khách. */
async function activeSession(db: Database): Promise<ActiveSessionRef | null> {
  const [row] = await db
    .select({ id: livestreamSessions.id, title: livestreamSessions.title })
    .from(livestreamSessions)
    .where(eq(livestreamSessions.isActive, true))
    .limit(1)
  return row ?? null
}

// ─── Gửi ─────────────────────────────────────────────────────────────────────

export type SendChatInput = {
  sender: ChatSender
  /** Địa chỉ đã giải qua `getClientIp(event)`, dùng cho hạn mức theo địa chỉ. */
  ip: string
  content: unknown
  /** Id received from this tab's SSE `ready` frame, never a room selector. */
  sessionId: unknown
}

export type SendChatResult =
  | { ok: true, id: number, delivered: number }
  | { ok: false, statusCode: number, message: string, retryAfterSeconds?: number }

/**
 * Lưu một tin nhắn rồi mới phát cho người đang xem.
 *
 * ## Thứ tự: mọi lý do TỪ CHỐI đứng trước, hạn mức đứng ngay trước câu INSERT
 *
 * Đây là 12.7, và nó là một quy tắc về **thứ tự** chứ không phải về việc có gọi
 * hay không. Trừ hạn mức ở đầu hàm nghĩa là: một người mà cả hai mươi lần thử đều
 * rơi vào lúc không có buổi phát nào đang chạy vẫn tiêu hết hạn mức của chính
 * mình, và tệ hơn, một kẻ tấn công tiêu được hạn mức của người khác bằng những
 * request **luôn luôn thất bại** — chúng không cần thoả điều kiện nào cả. Nên hai
 * lượt `recordRateLimitHit` nằm ngay trước câu INSERT, sau cả bốn nhánh từ chối.
 *
 * ## Phát SAU khi lưu
 *
 * Đặc tả nói thẳng: "the message is stored **and then** delivered". Phát trước rồi
 * mới lưu thì một lượt INSERT hỏng để lại một tin nhắn đã hiện trên màn hình hàng
 * trăm người và không nằm trong lịch sử của ai — người vào sau không thấy nó, và
 * người đã đọc nó thì không có cách nào biết nó chưa từng tồn tại.
 *
 * Người gửi **cũng** nhận tin qua đường phát, không phải qua phản hồi của request
 * này: phản hồi chỉ trả về id. Nhờ vậy tin nhắn của họ nằm đúng thứ tự với mọi
 * tin khác thay vì được chèn lạc vào chỗ mà trình duyệt đoán.
 */
export async function sendChatMessage(
  input: SendChatInput,
  deps: LivestreamChatDeps = {},
): Promise<SendChatResult> {
  const db = deps.db ?? getDb()

  // ── Lý do từ chối #1: nội dung. Chưa chạm hạn mức. ──
  const verdict = validateChatContent(input.content)
  if (!verdict.ok) return { ok: false, statusCode: 400, message: verdict.message }

  // ── Kiểm duyệt tức thì (< 1ms): chặn từ ngữ thô tục, chống phá, cờ bạc ──
  const preCheck = await fastPreModerate(verdict.content, {
    authorName: snapshotDisplayName(input.sender),
    authorIp: input.ip,
    targetType: 'livestream_chat',
    sessionId: input.sessionId ? String(input.sessionId) : undefined,
    contextTitle: `Livestream #${input.sessionId}`,
    contextUrl: '/media',
  })
  if (preCheck.blocked) {
    return { ok: false, statusCode: 400, message: preCheck.reason }
  }
  // ── Lý do từ chối #2: không có buổi phát nào đang chạy. ──
  const session = await activeSession(db)
  if (!session) {
    return { ok: false, statusCode: 409, message: 'Hiện không có buổi phát trực tiếp nào đang diễn ra.' }
  }
  // A tab can keep its socket while one broadcast ends and another begins.  Do
  // not let a delayed POST for the old room become the first message in the new
  // room.  The server still resolves the active session itself; this value only
  // proves that the caller is attached to that exact session.
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId !== session.id) {
    return { ok: false, statusCode: 409, message: 'Buổi phát đã thay đổi. Vui lòng kết nối lại trước khi gửi.' }
  }

  // ── Hết lý do để từ chối. Chỉ từ đây mới tiêu hạn mức. ──
  const limiter = deps.rateLimit ?? rateLimitDeps()

  const readerState = await recordRateLimitHit(`livestream:chat:reader:${input.sender.id}`, CHAT_READER_RULE, limiter)
  if (readerState.blocked) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một lát rồi thử lại.',
      retryAfterSeconds: Math.max(1, readerState.retryAfterSeconds),
    }
  }

  // Cùng khuôn với đường ghi bình luận: địa chỉ không đọc được thì gom vào một ô
  // chung, không bỏ qua hạn mức theo địa chỉ.
  const addressKey = input.ip && input.ip !== 'unknown' ? input.ip : 'anonymous'
  const ipState = await recordRateLimitHit(`livestream:chat:ip:${addressKey}`, CHAT_IP_RULE, limiter)
  if (ipState.blocked) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Đã có quá nhiều tin nhắn gửi từ địa chỉ này. Vui lòng chờ một lát rồi thử lại.',
      retryAfterSeconds: Math.max(1, ipState.retryAfterSeconds),
    }
  }

  // Một mốc thời gian cho cả hàng và bản phát đi: hai lượt `new Date()` riêng thì
  // tin nhắn hiện trên màn hình mang một mốc khác với mốc nằm trong CSDL, và lượt
  // tải lại sau đó sẽ xếp nó ở một chỗ khác.
  const now = new Date()
  const displayName = snapshotDisplayName(input.sender)

  const inserted = await db.insert(livestreamMessages).values({
    sessionId:   session.id,
    readerId:    input.sender.id,
    displayName,
    content:     verdict.content,
    // Không có mặc định ở tầng CSDL — cột này bắt buộc phải được đặt tường minh.
    createdAt:   now,
  })

  // Destructure: `db.insert()` trả về `[ResultSetHeader, FieldPacket[]]`, nên đọc
  // `.insertId` trên chính mảng đó ra `undefined` — và `Number(undefined ?? 0)` là
  // `0`, âm thầm. Cùng cái bẫy đã trả giá bốn lần trong dự án này.
  const [header] = inserted
  const id = Number(header?.insertId ?? 0)
  if (!id) {
    // Không có id thì không có gì để phát và không có gì để lịch sử trỏ tới.
    // Trả về thành công ở đây là báo cho người gửi rằng tin đã đi trong khi
    // không có hàng nào tồn tại.
    throw new Error('livestream_messages insert returned no id')
  }
  // ── Broadcast ngay, kiểm duyệt nền ──
  // Tin nhắn hiện ngay cho mọi người xem qua SSE. AI kiểm duyệt chạy nền
  // (không block response): nếu AI flag vi phạm, broadcast removal event
  // rồi xoá hàng trong DB. Người xem thấy tin biến mất thay vì chờ 11 giây
  // cho AI trả lời trước khi tin hiện.
  const message: ChatMessage = {
    id,
    displayName,
    content:     verdict.content,
    createdAt:   now.toISOString(),
  }
  const delivered = broadcastToSession(session.id, {
    event: SSE_EVENT_MESSAGE,
    data:  JSON.stringify(message),
  })

  // Kiểm duyệt AI nền — fire and forget, không block response
  const moderate = deps.moderate ?? (deps.db ? undefined : checkAndModerateContent)
  if (moderate) {
    void moderate({
      content: verdict.content,
      targetType: 'livestream_chat',
      targetId: id,
      authorName: displayName,
      authorIp: input.ip,
      sessionId: String(session.id),
      contextTitle: `Livestream: ${session.title}`,
      contextUrl: '/media',
    }).then((modResult) => {
      if (modResult.flagged && modResult.action === 'auto_hide') {
        // AI flag vi phạm — broadcast removal rồi xoá hàng
        broadcastToSession(session.id, {
          event: SSE_EVENT_REMOVAL,
          data:  JSON.stringify({ id }),
        })
        // Xoá trong DB — fire and forget, tự nuốt lỗi
        db.delete(livestreamMessages).where(eq(livestreamMessages.id, id))
          .catch(() => {})
      }
    }).catch(() => {
      // Lỗi AI không được làm hỏng tin đã gửi — chỉ log
    })
  }

  return { ok: true, id, delivered }
}

// ─── Lịch sử ─────────────────────────────────────────────────────────────────

export type ChatHistoryResult = {
  /** `null` khi không có buổi phát nào đang chạy — trang thái hợp lệ, không phải lỗi. */
  sessionId: number | null
  messages: ChatMessage[]
}

/**
 * Lịch sử của buổi phát **đang chạy**, theo thứ tự thời gian.
 *
 * Phiên do máy chủ giải (xem đầu tệp): nhận `sessionId` từ request là mở lịch sử
 * của mọi buổi phát cũ cho bất kỳ ai đoán được một số nguyên.
 *
 * Lấy **N tin gần nhất** rồi đảo lại, chứ không lấy N tin đầu: người vào muộn cần
 * thấy câu vừa nói, không phải câu mở đầu buổi phát. Sắp xếp kèm `id` làm khoá phụ
 * vì `created_at` là DATETIME(3) và hai tin trong cùng một mili giây là chuyện
 * bình thường — chỉ sắp theo thời gian thì thứ tự của chúng do máy chủ quyết định
 * và có thể đổi giữa hai lượt đọc.
 *
 * `is_deleted = 0` nằm trong mệnh đề WHERE, nên tin đã kiểm duyệt không bao giờ
 * rời khỏi CSDL — không phải lọc ở tầng giao diện, nơi một lượt quên lọc là một
 * tin đã xoá hiện lại.
 */
export async function listChatHistory(
  input: { limit?: unknown } = {},
  deps: LivestreamChatDeps = {},
): Promise<ChatHistoryResult> {
  const db = deps.db ?? getDb()

  const session = await activeSession(db)
  if (!session) return { sessionId: null, messages: [] }

  // Vượt trần thì phục vụ **ở mức trần**, không từ chối: một lượt hỏi xin nhiều
  // hơn mức máy chủ cho là chuyện bình thường, và trả 400 cho nó là biến một yêu
  // cầu hợp lệ thành một ô chat trống.
  const limit = finitePositive(input.limit, CHAT_HISTORY_DEFAULT, CHAT_HISTORY_MAX)

  const rows = await db
    .select({
      id:          livestreamMessages.id,
      displayName: livestreamMessages.displayName,
      content:     livestreamMessages.content,
      createdAt:   livestreamMessages.createdAt,
    })
    .from(livestreamMessages)
    .where(and(
      eq(livestreamMessages.sessionId, session.id),
      eq(livestreamMessages.isDeleted, false),
    ))
    .orderBy(desc(livestreamMessages.createdAt), desc(livestreamMessages.id))
    .limit(limit)

  return { sessionId: session.id, messages: rows.reverse().map(serializeChatMessage) }
}

// ─── Kiểm duyệt ──────────────────────────────────────────────────────────────

export type RemoveMessageInput = {
  messageId: number
  /** Id tài khoản cán bộ, lấy từ phiên quản trị — không bao giờ từ thân request. */
  actorId: number
}

export type RemoveMessageResult =
  | { ok: true, alreadyRemoved: boolean, sessionId: number, messageId: number }
  | { ok: false, statusCode: number, message: string }

/**
 * Đánh dấu một tin nhắn là đã gỡ, rồi báo cho người đang xem.
 *
 * ## Gỡ hai lần là thành công, và KHÔNG sinh bản ghi thứ hai
 *
 * Điều kiện `is_deleted = 0` nằm **trong câu UPDATE**, không phải trong một lượt
 * đọc trước đó: đọc-rồi-ghi thì hai cán bộ bấm cùng lúc đều thấy "chưa gỡ" và đều
 * ghi, sinh hai dòng audit cho một hành động. `affectedRows` là **thẩm quyền**
 * quyết định ai thật sự gỡ — đọc qua `affectedRowsOrZero()`, không bao giờ tự ép
 * kiểu (xem `server/utils/affected-rows.ts`).
 *
 * Lượt gỡ thứ hai vẫn trả về thành công: mục tiêu của người bấm đã đạt được, và
 * báo lỗi cho họ là mời họ đi tìm một hàng mà họ không cần biết là ai đã gỡ.
 *
 * ## Gỡ KHÔNG phải xoá
 *
 * Hàng ở lại. Đặc tả nói thẳng, và lý do là chính hành động kiểm duyệt phải kiểm
 * toán được: một hàng biến mất thì dòng audit vừa ghi không còn gì để đối chiếu.
 *
 * Audit và UPDATE commit cùng nhau — `tx.insert(activityLogs)`, **không bao giờ**
 * `db.insert(activityLogs)` trong khối, vì lời gọi thứ hai vẫn chạy trên pool và
 * commit độc lập.
 */
export async function removeChatMessage(
  input: RemoveMessageInput,
  deps: LivestreamChatDeps = {},
): Promise<RemoveMessageResult> {
  const db = deps.db ?? getDb()

  let sessionId = 0
  let alreadyRemoved = false

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ sessionId: livestreamMessages.sessionId, isDeleted: livestreamMessages.isDeleted })
      .from(livestreamMessages)
      .where(eq(livestreamMessages.id, input.messageId))
      .limit(1)

    if (!row) return

    sessionId = row.sessionId
    if (Boolean(row.isDeleted)) {
      alreadyRemoved = true
      return
    }

    const updated = await tx
      .update(livestreamMessages)
      .set({ isDeleted: true })
      .where(and(
        eq(livestreamMessages.id, input.messageId),
        eq(livestreamMessages.isDeleted, false),
      ))

    if (affectedRowsOrZero(updated) === 0) {
      // Thua cuộc đua với một cán bộ khác giữa lượt đọc và lượt ghi. Hàng đã bị
      // gỡ, việc đã xong, nhưng **mình không phải người làm** — nên không có dòng
      // audit thứ hai, đúng như lượt gỡ trùng ở trên.
      alreadyRemoved = true
      return
    }

    await tx.insert(activityLogs).values({
      userId:     input.actorId,
      action:     'delete',
      resource:   'livestream',
      resourceId: input.messageId,
      // Chỉ id. Không nội dung tin nhắn, không tên người gửi: dòng audit này trả
      // lời "ai đã gỡ tin nào của buổi phát nào", và chép nội dung sang đây là để
      // lại chính dữ liệu đó ở một bảng thứ hai.
      meta: { sessionId: row.sessionId, messageId: input.messageId, operation: 'remove_chat_message' },
    })
  })

  if (!sessionId) {
    return { ok: false, statusCode: 404, message: 'Không tìm thấy tin nhắn cần gỡ.' }
  }

  if (!alreadyRemoved) {
    broadcastToSession(sessionId, {
      event: SSE_EVENT_REMOVAL,
      data:  JSON.stringify({ id: input.messageId }),
    })
  }

  return { ok: true, alreadyRemoved, sessionId, messageId: input.messageId }
}
