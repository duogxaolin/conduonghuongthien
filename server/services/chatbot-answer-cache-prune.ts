/**
 * Lượt dọn định kỳ của cache câu trả lời chatbot (`chatbot_answer_cache`).
 *
 * Vì sao phải có: `pruneAnswerCache` cũ không được gọi ở đâu (kiểm 2026-11-06). Mỗi lần sửa
 * bài viết/kho kiến thức là tăng phiên bản — mọi hàng cũ thành không tra tới được nhưng vẫn nằm
 * lại, trần 20 000 hàng không có tác dụng, và cột `question` (câu hỏi đầu của người dân, có thể có
 * tên, số điện thoại, tình tiết vụ án) sống VÔ THỜI HẠN — ngoài phạm vi lưu giữ của
 * `chat_sessions` (tối thiểu 30 ngày, `data-retention-config.ts`).
 *
 * Ba bước, mỗi bước một lý do:
 *   1. hàng hết hạn (`expires_at`) — TTL 30 ngày, đồng thời là trần lưu giữ câu hỏi;
 *   2. hàng CHẾT: dựng lại khoá từ câu hỏi đã lưu với cấu hình + phiên bản hiện tại không ra khoá
 *      của hàng (`answerCacheKeyIsLive`) — không lượt hỏi nào còn tới nó;
 *   3. vượt trần — cắt theo `last_used_at` cũ nhất.
 * Đọc theo trang khoá tăng dần, nhường event loop giữa các trang (chạy trong tiến trình phục vụ người dân).
 *
 * Chạy cùng công tắc với bộ dọn dữ liệu (`server/plugins/retention-scheduler.ts`, `RETENTION_SCHEDULER`)
 * và trong lệnh cron `npm run analytics:maintenance`. Không khoá tên: mọi lệnh là DELETE theo điều
 * kiện, chạy trùng chỉ xoá trùng thứ đã phải xoá.
 */
import { asc, count, gt, inArray, lt } from 'drizzle-orm'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { chatbotAnswerCache } from '../db/schema'
import { getDb, getPool } from '../utils/db'
import { affectedRowsOrZero } from '../utils/affected-rows'
import { logError, logInfo } from '../utils/logger'
import { ANSWER_CACHE_MAX_ROWS, answerCacheContext } from './chatbot-answer-cache'
import { answerCacheKeyer } from '../utils/chatbot/answer-cache-key'

/** Mỗi lệnh DELETE theo khoá tối đa ngần này khoá (giữ câu lệnh và gói tin nhỏ). */
const DELETE_CHUNK = 500
/**
 * Hàng đọc mỗi trang khi tìm hàng chết. Đọc theo trang (khoá tăng dần) và nhường event loop giữa hai
 * trang: lượt dọn chạy trong CHÍNH tiến trình phục vụ người dân, nạp cả bảng rồi dựng khoá liền một mạch
 * từng chặn ~1 s ở 20 000 hàng (verifier 2026-11-06).
 */
const SCAN_PAGE = 1000

export type AnswerCachePruneResult = { expired: number, dead: number, overCap: number }

async function deleteKeys(keys: string[]): Promise<number> {
  const db = getDb()
  let removed = 0
  for (let start = 0; start < keys.length; start += DELETE_CHUNK) {
    const chunk = keys.slice(start, start + DELETE_CHUNK)
    removed += affectedRowsOrZero(await db.delete(chatbotAnswerCache).where(inArray(chatbotAnswerCache.cacheKey, chunk)))
  }
  return removed
}

/**
 * Một lượt dọn. Ném lỗi khi CSDL hỏng — `reportAnswerCachePrune` là bản không ném.
 * `maxRows`/`pageSize` chỉ để test chạm được trần và nhiều trang mà không phải chèn hàng chục nghìn hàng.
 */
export async function pruneAnswerCache(options: { now?: Date, maxRows?: number, pageSize?: number } = {}): Promise<AnswerCachePruneResult> {
  const now = options.now ?? new Date()
  const maxRows = options.maxRows ?? ANSWER_CACHE_MAX_ROWS
  const pageSize = options.pageSize ?? SCAN_PAGE
  const db = getDb()
  const expired = affectedRowsOrZero(await db.delete(chatbotAnswerCache).where(lt(chatbotAnswerCache.expiresAt, now)))

  // Chưa có hàng cấu hình thì cũng không có khoá nào tính được: mọi hàng đều chết. Đọc cấu hình TRƯỚC trang
  // đầu: phiên bản tăng giữa chừng chỉ làm hàng ghi dưới phiên bản mới bị coi là chết (mất một lượt cache),
  // không bao giờ giữ lại hàng cũ.
  const context = await answerCacheContext()
  const keyFor = context ? answerCacheKeyer(context.settings, context.version) : () => null
  let dead = 0
  let after = ''
  for (;;) {
    const page = await db.select({ cacheKey: chatbotAnswerCache.cacheKey, question: chatbotAnswerCache.question })
      .from(chatbotAnswerCache)
      .where(gt(chatbotAnswerCache.cacheKey, after))
      .orderBy(asc(chatbotAnswerCache.cacheKey))
      .limit(pageSize)
    if (page.length === 0) break
    dead += await deleteKeys(page.filter(row => keyFor(row.question) !== row.cacheKey).map(row => row.cacheKey))
    after = page[page.length - 1]!.cacheKey
    if (page.length < pageSize) break
    await yieldToEventLoop()
  }

  let overCap = 0
  const [total] = await db.select({ total: count() }).from(chatbotAnswerCache)
  const excess = Number(total?.total ?? 0) - maxRows
  if (excess > 0) {
    const oldest = await db
      .select({ key: chatbotAnswerCache.cacheKey })
      .from(chatbotAnswerCache)
      .orderBy(chatbotAnswerCache.lastUsedAt, chatbotAnswerCache.cacheKey)
      .limit(excess)
    overCap = await deleteKeys(oldest.map(item => item.key))
  }
  return { expired, dead, overCap }
}

export type AnswerCachePruneReport =
  | ({ ran: true } & AnswerCachePruneResult)
  | { ran: false, skipped: 'no-database' }
  | { ran: false, error: string }

/** Một lượt không bao giờ ném: lỗi thành `{ ran: false, error }` + log `chatbot.answer_cache_prune_failed`. */
export async function reportAnswerCachePrune(): Promise<AnswerCachePruneReport> {
  if (!getPool()) return { ran: false, skipped: 'no-database' }
  try {
    const result = await pruneAnswerCache()
    if (result.expired + result.dead + result.overCap > 0) logInfo({ event: 'chatbot.answer_cache_pruned', ...result })
    return { ran: true, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError({ event: 'chatbot.answer_cache_prune_failed', message, consequence: 'stale rows remain until the next tick' })
    return { ran: false, error: message }
  }
}

/** Mỗi 15 phút: hàng chết sau một lần sửa bài không nằm lại quá một nhịp. */
export const ANSWER_CACHE_PRUNE_TICK_MS = 15 * 60 * 1000
/** Lượt đầu sau khi khởi động — init/migration có thể còn đang chạy, như các bộ dọn khác. */
const WARMUP_MS = 120_000

let timer: ReturnType<typeof setInterval> | null = null
let warmup: ReturnType<typeof setTimeout> | null = null

/** Idempotent; cả hai timer `unref()` để lượt dọn không bao giờ giữ tiến trình lại khi tắt. */
export function startAnswerCachePruneScheduler(): void {
  if (timer) return
  const tick = () => { void reportAnswerCachePrune() }
  timer = setInterval(tick, ANSWER_CACHE_PRUNE_TICK_MS)
  timer.unref?.()
  warmup = setTimeout(() => {
    warmup = null
    tick()
  }, WARMUP_MS)
  warmup.unref?.()
}

export function stopAnswerCachePruneScheduler(): void {
  if (warmup) {
    clearTimeout(warmup)
    warmup = null
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
