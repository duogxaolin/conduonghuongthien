/**
 * "Quét & dọn sạch nội dung cũ" chạy NỀN, một lượt một lúc.
 *
 * Trước đây endpoint `rescan-all` gọi `rescanExistingContent()` ngay trong request:
 * nạp MỌI bình luận đang hiện, mỗi bình luận một lượt gọi AI, không khoá. Proxy cắt
 * request khi hết giờ trong lúc vòng lặp vẫn chạy tiếp, và cán bộ bấm lần hai (vì
 * tưởng lần đầu hỏng) là nhân đôi chi phí AI.
 *
 * Nay:
 *  - Khoá đơn luồng hai lớp: cờ trong tiến trình (`status.state === 'running'`,
 *    đặt ĐỒNG BỘ trước mọi `await` để hai request cùng tiến trình không cùng lọt) và
 *    khoá tên MySQL `cdkt:ai:moderation-rescan` (timeout 0) cho nhiều bản sao. Lượt
 *    thứ hai nhận `started: false` → endpoint trả 409 kèm tiến độ.
 *  - Endpoint trả 202 ngay khi đã giữ khoá; việc quét chạy tiếp trên kết nối giữ
 *    khoá (`withNamedLock` nhả khoá khi xong hoặc khi kết nối rơi).
 *  - Mỗi lượt bị chặn trần (`MODERATION_RESCAN_LIMITS`) và đọc theo lô; con trỏ
 *    `resumeCursor` cho lượt sau quét tiếp phần còn lại thay vì quét lại từ đầu —
 *    kể cả khi lượt này HỎNG giữa chừng: con trỏ được lưu sau mỗi lô đã xong.
 *  - AI kiểm duyệt chưa cấu hình: lượt quét chuyển sang chỉ chạy luật cho bình luận
 *    (`summary.aiUnavailable`), không dồn mọi bình luận cũ vào hàng chờ `flag_only`;
 *    hàng chờ cũng không ghi thêm cho mục đã có hàng `pending`.
 *  - Tiến độ đọc qua `getModerationRescanStatus()` — trang trạng thái worker trả nó.
 *
 * GIỚI HẠN (cố ý, ghi rõ):
 *  - Tiến độ và con trỏ nằm trong BỘ NHỚ tiến trình. Khởi động lại thì mất: lượt
 *    sau quét lại từ bình luận mới nhất (đúng, chỉ tốn thêm lượt AI cho phần đã
 *    quét). Với nhiều bản sao, bản sao KHÔNG chạy job chỉ biết "đang chạy ở nơi
 *    khác" (khoá MySQL bận) chứ không thấy x/y.
 *  - Dòng nhật ký kiểm toán do endpoint ghi (qua `onFinished`), không ở tệp này.
 */
import { getPool } from '../utils/db'
import { withNamedLock } from '../utils/named-lock'
import { logError, logInfo } from '../utils/logger'
import {
  MODERATION_RESCAN_LIMITS,
  rescanExistingContent,
  type RescanCursor,
  type RescanProgress,
  type RescanSummary,
} from './moderation-worker'

export const MODERATION_RESCAN_LOCK = 'cdkt:ai:moderation-rescan'

export type ModerationRescanState = 'idle' | 'running' | 'completed' | 'failed'

export interface ModerationRescanStatus {
  state: ModerationRescanState
  startedAt: string | null
  finishedAt: string | null
  startedBy: number | null
  progress: RescanProgress | null
  summary: RescanSummary | null
  error: string | null
  limits: typeof MODERATION_RESCAN_LIMITS
}

export type StartModerationRescanOutcome =
  | { started: true; status: ModerationRescanStatus }
  | { started: false; reason: 'running_here' | 'running_elsewhere'; status: ModerationRescanStatus }

export interface StartModerationRescanOptions {
  actorId: number | null
  /** Chạy sau khi lượt quét xong (vẫn trong khoá). Lỗi của nó được ghi log, không làm hỏng job. */
  onFinished?: (summary: RescanSummary) => Promise<void>
}

const IDLE: ModerationRescanStatus = Object.freeze({
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  startedBy: null,
  progress: null,
  summary: null,
  error: null,
  limits: MODERATION_RESCAN_LIMITS,
}) as ModerationRescanStatus

let status: ModerationRescanStatus = { ...IDLE }
let resumeCursor: RescanCursor = { commentsBeforeId: null, messagesBeforeId: null }
let currentJob: Promise<void> | null = null

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Ảnh chụp trạng thái — bản sao, nơi gọi không sửa được trạng thái của job. */
export function getModerationRescanStatus(): ModerationRescanStatus {
  return {
    ...status,
    progress: status.progress ? { ...status.progress } : null,
    summary: status.summary ? { ...status.summary, nextCursor: { ...status.summary.nextCursor } } : null,
  }
}

/** Promise của lượt đang/đã chạy gần nhất (đã xử lý lỗi bên trong — không bao giờ reject). */
export function waitForModerationRescan(): Promise<void> {
  return currentJob ?? Promise.resolve()
}

async function runRescan(options: StartModerationRescanOptions): Promise<void> {
  try {
    const summary = await rescanExistingContent({
      cursor: resumeCursor,
      onProgress: (progress) => { status.progress = progress },
      // Lưu tiến độ sau MỖI lô đã xong: lượt này hỏng giữa chừng (CSDL rơi khi đọc
      // lô kế tiếp — đã thử lại một lần) thì lượt sau quét tiếp từ đây thay vì quét
      // lại (và trả tiền AI lại) từ bình luận mới nhất.
      onCheckpoint: (cursor) => { resumeCursor = cursor },
    })
    resumeCursor = summary.nextCursor
    status = { ...status, state: 'completed', finishedAt: new Date().toISOString(), summary }
    if (options.onFinished) {
      try {
        await options.onFinished(summary)
      } catch (err: unknown) {
        logError({ event: 'ai_moderation.rescan_finish_hook_failed', error: describeError(err) })
      }
    }
  } catch (err: unknown) {
    status = { ...status, state: 'failed', finishedAt: new Date().toISOString(), error: describeError(err) }
    logError({ event: 'ai_moderation.rescan_failed', error: describeError(err) })
  }
}

/**
 * Bắt đầu một lượt quét nền. Trả về NGAY khi đã biết có giữ được khoá hay không —
 * không đợi quét xong.
 */
export async function startModerationRescan(options: StartModerationRescanOptions): Promise<StartModerationRescanOutcome> {
  if (status.state === 'running') {
    return { started: false, reason: 'running_here', status: getModerationRescanStatus() }
  }
  const pool = getPool()
  if (!pool) throw new Error('Cơ sở dữ liệu chưa sẵn sàng.')

  // Chiếm chỗ ĐỒNG BỘ, trước `await` đầu tiên: request thứ hai trong cùng tiến
  // trình đến trong lúc lượt này chờ GET_LOCK sẽ thấy `running` ở dòng đầu hàm.
  const previous = status
  status = {
    ...IDLE,
    state: 'running',
    startedAt: new Date().toISOString(),
    startedBy: options.actorId,
  }

  // `withNamedLock` chỉ trả về khi `action` XONG, nên quyết định "giữ được khoá
  // chưa" đi qua một promise riêng: dòng đầu của `action` báo true, `onBusy` báo
  // false, lỗi lấy kết nối / GET_LOCK báo reject.
  let decide!: (acquired: boolean) => void
  let fail!: (err: unknown) => void
  const decision = new Promise<boolean>((resolve, reject) => { decide = resolve; fail = reject })

  currentJob = withNamedLock(pool, MODERATION_RESCAN_LOCK, 0, async () => {
    decide(true)
    await runRescan(options)
  }, async () => { decide(false) })
    .then(() => undefined)
    .catch((err: unknown) => {
      // Chỉ tới được đây trước khi có quyết định (runRescan tự bắt lỗi của nó).
      fail(err)
    })

  let acquired: boolean
  try {
    acquired = await decision
  } catch (err: unknown) {
    status = previous
    throw err
  }

  if (!acquired) {
    status = previous
    return { started: false, reason: 'running_elsewhere', status: getModerationRescanStatus() }
  }

  logInfo({ event: 'ai_moderation.rescan_started', actorId: options.actorId, cursor: resumeCursor })
  return { started: true, status: getModerationRescanStatus() }
}
