/**
 * Vòng đời một buổi phát trực tiếp: bắt đầu, dừng, và lưu lại thành bản ghi.
 *
 * ## Bất biến "tối đa một buổi đang phát" do KHOÁ giữ, không do transaction
 *
 * Ở mức cô lập mặc định (`REPEATABLE READ`, và `server/utils/db.ts` không đặt mức
 * nào khác), hai lượt "bắt đầu" chạy cùng lúc **đều đọc ra "chưa có buổi nào đang
 * phát"** rồi đều chèn — một transaction không ngăn được điều đó. Cái ngăn được là
 * `GET_LOCK('cdkt:livestream:active', 0)` trên một kết nối của pool: lượt thứ hai
 * không lấy được khoá nên **bị từ chối ngay**, chứ không phải xếp hàng chờ. Cán
 * bộ bấm "Bắt đầu" khi đang có buổi phát phải nhận một câu trả lời tức thì, không
 * phải một request treo.
 *
 * `withNamedLock` (`server/utils/named-lock.ts`) đã lo phần nhả khoá trong
 * `finally` — **cả trên đường lỗi lẫn đường thành công**. Tự viết lại `GET_LOCK`
 * bằng tay ở đây là dựng bản sao thứ hai của một phép toán đã được kiểm, và bản
 * sao đó chỉ được đối chiếu vào lúc một lượt bắt đầu hỏng giữa chừng và để lại
 * khoá treo vĩnh viễn — tức là sau khi việc đã xảy ra.
 *
 * ## Vì sao KHÔNG có lượt "tắt mọi phiên đang active" trong transaction
 *
 * `design.md` §7 mô tả transaction bắt đầu là "tắt mọi phiên đang active rồi chèn
 * phiên mới". Ở đây nó **không có mặt**, và đó là chủ đích, không phải bỏ sót:
 * đặc tả yêu cầu bắt đầu khi đang phát phải **bị từ chối** — "no new row". Một
 * lượt tắt vô điều kiện biến đúng tình huống đó thành **thay thế ngầm**: buổi phát
 * của người đang xem bị cắt, hàng cũ mất cờ `is_active`, và không ai được báo.
 * Lượt đọc bên dưới nằm trong khoá nên nó là thẩm quyền duy nhất cần thiết.
 *
 * ## Id đọc vào biến cục bộ rồi `return` ra ngoài
 *
 * Không bao giờ đọc biến của chính khối transaction trong dòng audit bên trong
 * khối đó: đó là vùng chết tạm thời, và hình dạng đó đã làm **bốn** endpoint tạo
 * mới của dự án trả 500.
 */
import { and, eq } from 'drizzle-orm'

import { activityLogs, livestreamSessions } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { getDb, getPool, type Database } from '../utils/db'
import { withNamedLock } from '../utils/named-lock'
import { extractYouTubeVideoId } from '../utils/youtube-parser'
import { createMediaItem, MediaValidationError } from './media-portal'
import { HlsSourceError, validateHlsSource } from './livestream-hls'
import { closeSessionStreams, SSE_EVENT_ENDED } from '../utils/sse-manager'

/**
 * Tên khoá. Hằng số chứ không chuỗi rời: khoá là một giao kèo giữa những tiến
 * trình không đọc được mã của nhau, và một chỗ viết lệch một ký tự sẽ cho ra hai
 * khoá khác nhau — cả hai đều "lấy được", nên bất biến mất hiệu lực mà **không có
 * lỗi nào ở đâu cả**.
 */
export const LIVESTREAM_LOCK_NAME = 'cdkt:livestream:active'

/** Timeout 0 = không xếp hàng. Xem đầu tệp. */
const LIVESTREAM_LOCK_TIMEOUT_SECONDS = 0

export const LIVESTREAM_TITLE_MAX_LENGTH = 512
export const LIVESTREAM_DESCRIPTION_MAX_LENGTH = 5000
export const LIVESTREAM_STORAGE_PATH_MAX_LENGTH = 1024
export const LIVESTREAM_THUMBNAIL_MAX_LENGTH = 1024

const LIVESTREAM_SOURCES = ['youtube', 'upload'] as const
export type LivestreamSource = (typeof LIVESTREAM_SOURCES)[number]

/** Loại `Pool` suy từ chính `withNamedLock` — không viết tay kiểu của mysql2. */
type LockPool = Parameters<typeof withNamedLock>[0]

/**
 * Điểm tiêm cho test. `pool` dùng `!== undefined` chứ không `??`: một `pool` cố ý
 * đặt `null` (máy chủ chưa nối được CSDL) là một tình huống **phải từ chối**, và
 * `??` sẽ biến nó thành "chưa tiêm gì" rồi lặng lẽ lấy pool thật.
 */
export type LivestreamDeps = {
  db?: Database
  pool?: LockPool | null
}

export type LivestreamFailure = { ok: false, statusCode: number, message: string }
export type StartLivestreamResult = { ok: true, sessionId: number } | LivestreamFailure
export type StopLivestreamResult = { ok: true, sessionId: number } | LivestreamFailure
export type SaveRecordingResult =
  | { ok: true, mediaItemId: number, slug: string }
  | LivestreamFailure

// ─── Kiểm dữ liệu vào ────────────────────────────────────────────────────────

function requireTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new MediaValidationError('Tiêu đề buổi phát không được để trống.')
  if (title.length > LIVESTREAM_TITLE_MAX_LENGTH) {
    throw new MediaValidationError(`Tiêu đề buổi phát tối đa ${LIVESTREAM_TITLE_MAX_LENGTH} ký tự.`)
  }
  return title
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  if (text.length > max) throw new MediaValidationError(`${label} tối đa ${max} ký tự.`)
  return text
}

function requireSource(value: unknown): LivestreamSource {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!(LIVESTREAM_SOURCES as readonly string[]).includes(source)) {
    throw new MediaValidationError(`Nguồn phát phải là một trong: ${LIVESTREAM_SOURCES.join(', ')}.`)
  }
  return source as LivestreamSource
}

// ─── Bắt đầu ─────────────────────────────────────────────────────────────────

export type StartLivestreamInput = {
  title: unknown
  description?: unknown
  source?: unknown
  youtubeVideoId?: unknown
  storagePath?: unknown
  thumbnailUrl?: unknown
  createdBy: number
}

/**
 * Bắt đầu một buổi phát.
 *
 * Ba nhánh từ chối, và cả ba đều **không ghi gì**:
 *   - không lấy được khoá → 409 (một lượt bắt đầu/dừng khác đang chạy);
 *   - đang có buổi phát → 409 (đặc tả: "no new row");
 *   - dữ liệu vào không dùng được → 400.
 *
 * Dữ liệu vào được kiểm **trước** khi lấy khoá: một tiêu đề rỗng không có lý do gì
 * chiếm khoá của cả hệ thống, dù chỉ trong vài mili giây.
 */
export async function startLivestream(
  input: StartLivestreamInput,
  deps: LivestreamDeps = {},
): Promise<StartLivestreamResult> {
  let title: string
  let description: string | null
  let source: LivestreamSource
  let youtubeVideoId: string | null
  let storagePath: string | null
  let thumbnailUrl: string | null

  try {
    title = requireTitle(input.title)
    description = optionalText(input.description, LIVESTREAM_DESCRIPTION_MAX_LENGTH, 'Mô tả')
    source = requireSource(input.source ?? 'youtube')
    thumbnailUrl = optionalText(input.thumbnailUrl, LIVESTREAM_THUMBNAIL_MAX_LENGTH, 'Ảnh đại diện')

    if (source === 'youtube') {
      // Định danh video phải bóc ra được **ngay lúc lưu**. Nhận một giá trị không
      // nhận ra là để nó hỏng ở trang công khai, nơi khung nhúng trắng và không có
      // gì giải thích vì sao.
      youtubeVideoId = extractYouTubeVideoId(input.youtubeVideoId)
      if (!youtubeVideoId) {
        throw new MediaValidationError('Địa chỉ video không hợp lệ hoặc không được hỗ trợ.')
      }
      storagePath = null
    } else {
      // Nguồn tự lưu trữ không có định danh nền tảng — nó có đường dẫn trên máy
      // chủ. Thiếu đường dẫn thì buổi phát không có gì để phát.
      storagePath = await validateHlsSource(input.storagePath)
      youtubeVideoId = null
    }
  } catch (error) {
    if (error instanceof MediaValidationError || error instanceof HlsSourceError) {
      return { ok: false, statusCode: 400, message: error.message }
    }
    throw error
  }

  const db = deps.db ?? getDb()
  const pool = deps.pool !== undefined ? deps.pool : getPool()
  if (!pool) {
    // Không có pool thì không có khoá, và không có khoá thì bất biến "tối đa một
    // buổi đang phát" không còn gì giữ. Từ chối, không mở toang.
    return { ok: false, statusCode: 503, message: 'Hệ thống chưa sẵn sàng. Vui lòng thử lại sau.' }
  }

  const outcome = await withNamedLock(pool, LIVESTREAM_LOCK_NAME, LIVESTREAM_LOCK_TIMEOUT_SECONDS, async () => {
    return db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: livestreamSessions.id })
        .from(livestreamSessions)
        .where(eq(livestreamSessions.isActive, true))
        .limit(1)

      // Đang phát thì **từ chối**, không thay thế. Xem đầu tệp.
      if (active) return { created: 0 }

      const [inserted] = await tx.insert(livestreamSessions).values({
        title,
        description,
        source,
        youtubeVideoId,
        storagePath,
        thumbnailUrl,
        isActive: true,
        // `started_at` là DATETIME không mang múi giờ, và nó đi qua trình dựng
        // truy vấn Drizzle chứ không qua `pool.query` trần: câu lệnh trần áp
        // timezone của pool lên giá trị chưa mã hoá múi giờ và **lùi 7 giờ** —
        // đúng cái bẫy đã làm lịch cộng lượt xem âm thầm đổi hành vi.
        startedAt: new Date(),
        createdBy: input.createdBy,
      })

      const created = Number(inserted?.insertId ?? 0)
      if (!created) throw new Error('livestream_sessions insert returned no id')

      await tx.insert(activityLogs).values({
        userId: input.createdBy,
        action: 'create',
        resource: 'livestream',
        resourceId: created,
        // Chỉ id và giá trị không định danh. Tiêu đề **không** vào đây: nó là
        // chuỗi do người gõ quyết định, và nhật ký kiểm toán không phải chỗ chở nó.
        meta: { source, hasDescription: description !== null },
      })

      return { created }
    })
  })

  if (!outcome.acquired) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Một thao tác phát trực tiếp khác đang được xử lý. Vui lòng thử lại.',
    }
  }

  if (!outcome.value.created) {
    return { ok: false, statusCode: 409, message: 'Đang có một buổi phát trực tiếp. Hãy dừng buổi phát đó trước.' }
  }

  return { ok: true, sessionId: outcome.value.created }
}

// ─── Dừng ────────────────────────────────────────────────────────────────────

export type StopLivestreamInput = { sessionId: number, actorId: number }

type StopOutcome = { kind: 'stopped' } | { kind: 'not_found' } | { kind: 'not_active' }

/**
 * Dừng một buổi phát.
 *
 * **Không cần khoá.** Buổi phát đã đang chạy, nên không có bất biến nào để giữ —
 * và bắt một lượt dừng phải chờ khoá sẽ là giữ cán bộ lại đúng lúc họ cần dừng
 * khẩn cấp nhất.
 *
 * Điều kiện `is_active = 1` nằm **trong câu UPDATE**, không phải một lượt SELECT
 * trước đó: đọc-rồi-ghi thì hai lượt dừng đồng thời đều thấy "đang phát" và lượt
 * thứ hai ghi đè `ended_at` của lượt thứ nhất. `affectedRows` là thẩm quyền quyết
 * định, và nó được đọc qua `affectedRowsOrZero` chứ **không bao giờ tự ép kiểu** —
 * dự án đã trả giá sáu lần cho những phép đọc hình dạng sai kiểu đó.
 */
export async function stopLivestream(
  input: StopLivestreamInput,
  deps: LivestreamDeps = {},
): Promise<StopLivestreamResult> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId <= 0) {
    return { ok: false, statusCode: 400, message: 'Buổi phát không hợp lệ.' }
  }

  const db = deps.db ?? getDb()

  const outcome = await db.transaction(async (tx): Promise<StopOutcome> => {
    const [header] = await tx
      .update(livestreamSessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(and(
        eq(livestreamSessions.id, input.sessionId),
        eq(livestreamSessions.isActive, true),
      ))

    if (affectedRowsOrZero(header) === 0) {
      // Không sửa được hàng nào. Hai nguyên nhân, và chúng khác nhau với cán bộ:
      // buổi phát không tồn tại (404) hay đã dừng rồi (409). Lượt đọc này chỉ chạy
      // trên đường hỏng nên nó không tốn gì trên đường thường.
      const [row] = await tx
        .select({ id: livestreamSessions.id })
        .from(livestreamSessions)
        .where(eq(livestreamSessions.id, input.sessionId))
        .limit(1)

      return row ? { kind: 'not_active' } : { kind: 'not_found' }
    }

    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'livestream',
      resourceId: input.sessionId,
      meta: { from: 'active', to: 'stopped' },
    })

    return { kind: 'stopped' }
  })

  if (outcome.kind === 'not_found') {
    return { ok: false, statusCode: 404, message: 'Buổi phát không tồn tại.' }
  }
  if (outcome.kind === 'not_active') {
    return { ok: false, statusCode: 409, message: 'Buổi phát này đã dừng.' }
  }

  // The database transition is authoritative.  Only after it commits do we end
  // the sockets that belong to this session; closing them first would tell
  // viewers a broadcast ended even if the transaction later rolled back.
  await closeSessionStreams(input.sessionId, {
    event: SSE_EVENT_ENDED,
    data: 'Buổi phát đã kết thúc.',
  })
  return { ok: true, sessionId: input.sessionId }
}

// ─── Lưu thành bản ghi ───────────────────────────────────────────────────────

export type SaveRecordingInput = { sessionId: number, actorId: number }

type SaveOutcome =
  | { kind: 'saved', mediaItemId: number, slug: string }
  | { kind: 'not_found' }
  | { kind: 'active' }
  | { kind: 'already_saved', mediaItemId: number }
  | { kind: 'recording_required' }

/**
 * Lưu một buổi phát đã dừng thành một mục media.
 *
 * **Tất cả trong MỘT giao dịch**, và đây là chỗ `createMediaItem` nhận `tx` thay
 * vì `db`: hàng `media_items`, dòng audit của nó, cột `saved_media_id` trỏ ngược
 * lại phiên, và dòng audit của phiên phải cùng sống hoặc cùng chết. Gọi
 * `createMediaItem` trước rồi ghi `saved_media_id` sau (hai giao dịch) sẽ để lại
 * một mục media mồ côi không ai trỏ tới khi lượt ghi thứ hai hỏng — và triệu chứng
 * là một video trùng trong thư viện mà không gì giải thích nó từ đâu ra.
 *
 * Drizzle lồng giao dịch bằng `SAVEPOINT`, không mở giao dịch thứ hai, nên lượt
 * gọi lồng này vẫn là **một** giao dịch thật.
 *
 * Buổi phát **đang chạy** thì bị từ chối: lưu một buổi chưa kết thúc nghĩa là
 * chốt lại một bản ghi thiếu đúng phần đuôi của nó.
 *
 * Buổi phát **đã lưu rồi** cũng bị từ chối. Đặc tả không nêu nhánh này, nhưng nó
 * là một lời bảo vệ đáng có: mục media tạo ra mang `status: 'draft'`, nên một cú
 * bấm thứ hai sinh thêm một bản nháp trùng mà không ai sẽ đi xoá, còn bản đầu tiên
 * thì **mất liên kết duy nhất** trỏ tới nó. Hỏng dữ liệu vì một cú bấm đúp là cái
 * giá không đáng trả.
 */
export async function saveSessionAsRecording(
  input: SaveRecordingInput,
  deps: LivestreamDeps = {},
): Promise<SaveRecordingResult> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId <= 0) {
    return { ok: false, statusCode: 400, message: 'Buổi phát không hợp lệ.' }
  }

  const db = deps.db ?? getDb()

  const outcome = await db.transaction(async (tx): Promise<SaveOutcome> => {
    const [session] = await tx
      .select({
        id: livestreamSessions.id,
        title: livestreamSessions.title,
        description: livestreamSessions.description,
        source: livestreamSessions.source,
        youtubeVideoId: livestreamSessions.youtubeVideoId,
        storagePath: livestreamSessions.storagePath,
        isActive: livestreamSessions.isActive,
        savedMediaId: livestreamSessions.savedMediaId,
      })
      .from(livestreamSessions)
      .where(eq(livestreamSessions.id, input.sessionId))
      .limit(1)

    if (!session) return { kind: 'not_found' }
    if (session.isActive) return { kind: 'active' }
    if (session.savedMediaId) return { kind: 'already_saved', mediaItemId: session.savedMediaId }
    // A rotating live playlist is not a recorded original. Creating a pending
    // media item here leaves a job without any original file to transcode.
    if (session.source === 'upload') return { kind: 'recording_required' }

    const created = await createMediaItem({
      title: session.title,
      description: session.description,
      source: session.source,
      youtubeVideoId: session.youtubeVideoId,
      storagePath: session.storagePath,
      createdBy: input.actorId,
    }, { db: tx })

    await tx
      .update(livestreamSessions)
      .set({ savedMediaId: created.mediaItemId })
      .where(eq(livestreamSessions.id, input.sessionId))

    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'livestream',
      resourceId: input.sessionId,
      // Hai id, không có slug và không có tiêu đề: câu hỏi nhật ký này phải trả lời
      // được là "buổi phát nào đã sinh ra mục media nào".
      meta: { savedMediaId: created.mediaItemId },
    })

    return { kind: 'saved', mediaItemId: created.mediaItemId, slug: created.slug }
  })

  switch (outcome.kind) {
    case 'not_found':
      return { ok: false, statusCode: 404, message: 'Buổi phát không tồn tại.' }
    case 'active':
      return { ok: false, statusCode: 409, message: 'Hãy dừng buổi phát trước khi lưu thành bản ghi.' }
    case 'already_saved':
      return { ok: false, statusCode: 409, message: 'Buổi phát này đã được lưu thành bản ghi.' }
    case 'recording_required':
      return { ok: false, statusCode: 409, message: 'Hãy xuất tệp ghi hình từ bộ mã hóa rồi tải lên Thư viện Media. Luồng HLS trực tiếp không phải bản ghi.' }
    default:
      return { ok: true, mediaItemId: outcome.mediaItemId, slug: outcome.slug }
  }
}

// ─── Đọc trạng thái ──────────────────────────────────────────────────────────

/**
 * Buổi phát đang chạy, hoặc `null`.
 *
 * Trả về **đúng những cột mà trang công khai được phép thấy** — không `created_by`,
 * không `saved_media_id`. Đây là lý do hàm này tồn tại thay vì để nơi gọi tự
 * `select()`: một lượt `select()` trần trên bảng sẽ tự động rò thêm cột mỗi lần ai
 * đó thêm cột mới, và không có gì báo.
 */
export type ActiveLivestream = {
  id: number
  title: string
  description: string | null
  source: string
  youtubeVideoId: string | null
  storagePath: string | null
  thumbnailUrl: string | null
  startedAt: Date | null
}

export async function getActiveLivestream(): Promise<ActiveLivestream | null> {
  const [row] = await getDb()
    .select({
      id: livestreamSessions.id,
      title: livestreamSessions.title,
      description: livestreamSessions.description,
      source: livestreamSessions.source,
      youtubeVideoId: livestreamSessions.youtubeVideoId,
      storagePath: livestreamSessions.storagePath,
      thumbnailUrl: livestreamSessions.thumbnailUrl,
      startedAt: livestreamSessions.startedAt,
    })
    .from(livestreamSessions)
    .where(eq(livestreamSessions.isActive, true))
    .limit(1)

  return row ?? null
}
