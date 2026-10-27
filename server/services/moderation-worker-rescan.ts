/**
 * Quét lại nội dung cũ theo lô có trần (`rescanExistingContent`). Tách nguyên văn từ
 * moderation-worker.ts (wave3 D-SPLIT); barrel `moderation-worker.ts` xuất lại. Job nền
 * `moderation-rescan-job.ts` gọi qua barrel, dưới khoá tên.
 */
import { and, count, desc, eq, lt } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments, livestreamMessages } from '../db/schema'
import { logWarn, logInfo, logError } from '../utils/logger'
import { fastPreModerate } from './moderation-worker-prescreen'
import { checkAndModerateContent } from './moderation-worker-check'
import { applyAutoHide, describeError } from './moderation-worker-persist'
import type { ModerationPersistFailure } from './moderation-worker-types'

/**
 * Retroactive cleaner: scans all existing non-hidden comments & non-deleted livestream messages.
 * Uses `checkAndModerateContent` for article comments so the AI context pass also
 * runs — `fastPreModerate` alone only catches built-in regex/keyword matches and
 * lets subtle defamation or distortion through, which read as "moderation stopped
 * filtering". Livestream chat stays on `fastPreModerate` because it is a live
 * stream: sub-second latency matters more than a context pass, and the entry
 * path already moderates each message in real time.
 *
 * BOUNDED: rows are read in keyset batches (newest first, `id < cursor`), and one
 * run stops after `maxComments` / `maxMessages`. Before this, every visible
 * comment was loaded at once and each cost one AI call, synchronously inside the
 * HTTP request — a proxy timeout while the loop kept running, and a second click
 * doubled the AI spend. The caller (`moderation-rescan-job.ts`) runs this in the
 * background under a named lock and passes `cursor` back in, so a capped run is
 * resumed by the next one instead of re-scanning the same newest rows forever.
 *
 * One item failing (AI, DB) never aborts the run: it is logged with its id and
 * counted in `failedComments` / `failedMessages`, and an item whose hide write
 * failed is NOT counted as hidden.
 */
export const MODERATION_RESCAN_LIMITS = Object.freeze({
  /** Rows read per query. */
  batchSize: 100,
  /** Comments per run — each one is an AI call. */
  maxComments: 1000,
  /** Livestream messages per run — rule matching only, no AI. */
  maxMessages: 5000,
})

/** Where the next run resumes: scan ids strictly below these. `null` = from the newest row. */
export interface RescanCursor {
  commentsBeforeId: number | null
  messagesBeforeId: number | null
}

export interface RescanCounts {
  scannedComments: number
  hiddenComments: number
  failedComments: number
  scannedMessages: number
  deletedMessages: number
  failedMessages: number
}

export interface RescanProgress extends RescanCounts {
  phase: 'comments' | 'messages' | 'done'
  /** Rows this run will scan (remaining rows, capped). The "y" in "x/y". */
  totalComments: number
  totalMessages: number
}

export interface RescanSummary extends RescanCounts {
  totalComments: number
  totalMessages: number
  /** True when rows remain beyond this run's cap; the next run resumes at `nextCursor`. */
  truncated: boolean
  nextCursor: RescanCursor
  /**
   * AI kiểm duyệt chưa cấu hình: bình luận được quét bằng LUẬT (chặn tức thì + luật
   * tuỳ biến) thay vì dồn hết vào hàng chờ `flag_only`.
   */
  aiUnavailable: boolean
}

export interface RescanOptions {
  batchSize?: number
  maxComments?: number
  maxMessages?: number
  cursor?: RescanCursor
  onProgress?: (progress: RescanProgress) => void
  /**
   * Gọi sau MỖI lô đã quét xong với con trỏ "quét tiếp từ đây". Lượt chạy hỏng giữa
   * chừng (CSDL rơi khi đọc lô sau) thì lượt kế tiếp tiếp tục từ lô cuối đã xong,
   * không quét lại (và trả tiền AI lại) từ bình luận mới nhất.
   */
  onCheckpoint?: (cursor: RescanCursor) => void
  /**
   * Chạy TRƯỚC mỗi lần đọc một lô (bình luận lẫn tin chat). Ném lỗi → lượt quét dừng
   * ngay, lỗi đi thẳng ra nơi gọi (không thử lại, không nuốt) — con trỏ đã lưu qua
   * `onCheckpoint` vẫn đúng tới lô cuối đã xong. Job nền dùng nó để kiểm còn giữ khoá
   * tên MySQL (`moderation-rescan-job.ts`).
   */
  beforeBatch?: () => Promise<void>
}

/** Một lô đọc hỏng được thử lại đúng một lần trước khi lượt quét dừng. */
async function readBatchWithRetry<T>(read: () => Promise<T>, what: 'comments' | 'messages'): Promise<T> {
  try {
    return await read()
  } catch (err: unknown) {
    logWarn({ event: 'ai_moderation.rescan_batch_retry', phase: what, error: describeError(err) })
    return await read()
  }
}

export async function rescanExistingContent(options: RescanOptions = {}): Promise<RescanSummary> {
  const db = getDb()
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? MODERATION_RESCAN_LIMITS.batchSize))
  const maxComments = Math.max(0, Math.trunc(options.maxComments ?? MODERATION_RESCAN_LIMITS.maxComments))
  const maxMessages = Math.max(0, Math.trunc(options.maxMessages ?? MODERATION_RESCAN_LIMITS.maxMessages))
  const startComments = options.cursor?.commentsBeforeId ?? null
  const startMessages = options.cursor?.messagesBeforeId ?? null

  const commentScope = (beforeId: number | null) =>
    and(eq(articleComments.isHidden, false), beforeId !== null ? lt(articleComments.id, beforeId) : undefined)
  const messageScope = (beforeId: number | null) =>
    and(eq(livestreamMessages.isDeleted, false), beforeId !== null ? lt(livestreamMessages.id, beforeId) : undefined)

  const [commentCount] = await db.select({ total: count() }).from(articleComments).where(commentScope(startComments))
  const [messageCount] = await db.select({ total: count() }).from(livestreamMessages).where(messageScope(startMessages))
  const remainingComments = Number(commentCount?.total ?? 0)
  const remainingMessages = Number(messageCount?.total ?? 0)

  const progress: RescanProgress = {
    phase: 'comments',
    totalComments: Math.min(remainingComments, maxComments),
    totalMessages: Math.min(remainingMessages, maxMessages),
    scannedComments: 0,
    hiddenComments: 0,
    failedComments: 0,
    scannedMessages: 0,
    deletedMessages: 0,
    failedMessages: 0,
  }
  const report = () => options.onProgress?.({ ...progress })
  report()

  let commentCursor = startComments
  let messageCursor = startMessages
  const checkpoint = () => options.onCheckpoint?.({ commentsBeforeId: commentCursor, messagesBeforeId: messageCursor })

  // 1. Scan article_comments — full context pass (fast pre-moderator + AI). When AI
  // moderation turns out NOT to be configured, the rest of the run is rules-only:
  // queueing every old visible comment as `flag_only` just floods the review queue.
  let aiUnavailable = false
  const rulesOnly = async (c: { id: number; body: string }) => {
    const check = await fastPreModerate(c.body, { targetType: 'comment', contextTitle: `Quét lại bình luận #${c.id}` })
    if (!check.blocked) return
    const failures: ModerationPersistFailure[] = []
    if (await applyAutoHide('comment', c.id, check.reason, failures)) progress.hiddenComments++
    else progress.failedComments++
  }
  while (progress.scannedComments < progress.totalComments) {
    await options.beforeBatch?.()
    const take = Math.min(batchSize, progress.totalComments - progress.scannedComments)
    const batch = await readBatchWithRetry(() => db
      .select({ id: articleComments.id, body: articleComments.body })
      .from(articleComments)
      .where(commentScope(commentCursor))
      .orderBy(desc(articleComments.id))
      .limit(take), 'comments')
    if (batch.length === 0) break

    for (const c of batch) {
      commentCursor = c.id
      progress.scannedComments++
      try {
        if (aiUnavailable) {
          await rulesOnly(c)
        } else {
          const result = await checkAndModerateContent({
            content: c.body,
            targetType: 'comment',
            targetId: c.id,
            contextTitle: `Quét lại bình luận #${c.id}`,
          }, { onAiUnavailable: 'skip' })
          if (result.aiUnavailable) {
            aiUnavailable = true
            logWarn({ event: 'ai_moderation.rescan_ai_unavailable', commentId: c.id })
            await rulesOnly(c)
          } else {
            if (result.flagged && result.action === 'auto_hide' && result.hidden) progress.hiddenComments++
            if (result.failures?.length) progress.failedComments++
          }
        }
      } catch (err: unknown) {
        progress.failedComments++
        logError({ event: 'ai_moderation.rescan_item_failed', targetType: 'comment', targetId: c.id, error: describeError(err) })
      }
      report()
    }
    checkpoint()
  }

  // 2. Scan livestream_messages — fast path only (live stream, latency-sensitive)
  progress.phase = 'messages'
  report()
  while (progress.scannedMessages < progress.totalMessages) {
    await options.beforeBatch?.()
    const take = Math.min(batchSize, progress.totalMessages - progress.scannedMessages)
    const batch = await readBatchWithRetry(() => db
      .select({ id: livestreamMessages.id, content: livestreamMessages.content })
      .from(livestreamMessages)
      .where(messageScope(messageCursor))
      .orderBy(desc(livestreamMessages.id))
      .limit(take), 'messages')
    if (batch.length === 0) break

    for (const m of batch) {
      messageCursor = m.id
      progress.scannedMessages++
      try {
        const check = await fastPreModerate(m.content, {
          targetType: 'livestream_chat',
          contextTitle: `Quét lại tin chat trực tiếp #${m.id}`,
        })
        if (check.blocked) {
          const failures: ModerationPersistFailure[] = []
          if (await applyAutoHide('livestream_chat', m.id, check.reason, failures)) progress.deletedMessages++
          else progress.failedMessages++
        }
      } catch (err: unknown) {
        progress.failedMessages++
        logError({ event: 'ai_moderation.rescan_item_failed', targetType: 'livestream_chat', targetId: m.id, error: describeError(err) })
      }
      report()
    }
    checkpoint()
  }

  progress.phase = 'done'
  report()

  // Rows left beyond the cap → resume below the last scanned id next run. Otherwise
  // start again from the newest row (the queue was walked to its end).
  const commentsTruncated = remainingComments > progress.scannedComments && progress.scannedComments >= maxComments
  const messagesTruncated = remainingMessages > progress.scannedMessages && progress.scannedMessages >= maxMessages
  const summary: RescanSummary = {
    scannedComments: progress.scannedComments,
    hiddenComments: progress.hiddenComments,
    failedComments: progress.failedComments,
    scannedMessages: progress.scannedMessages,
    deletedMessages: progress.deletedMessages,
    failedMessages: progress.failedMessages,
    totalComments: progress.totalComments,
    totalMessages: progress.totalMessages,
    truncated: commentsTruncated || messagesTruncated,
    nextCursor: {
      commentsBeforeId: commentsTruncated ? commentCursor : null,
      messagesBeforeId: messagesTruncated ? messageCursor : null,
    },
    aiUnavailable,
  }

  logInfo({ event: 'ai_moderation.rescan_completed', ...summary })
  return summary
}
