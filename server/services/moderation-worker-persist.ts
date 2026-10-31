/**
 * Đường ghi của kiểm duyệt: hàng chờ duyệt (`insertQueueRowOnce`) và ẩn/gắn cờ/xoá
 * hàng đích (`applyAutoHide`), cùng hai helper ghi lỗi. Tách nguyên văn từ
 * moderation-worker.ts (wave3 D-SPLIT). Barrel KHÔNG xuất lại tệp này: đây là helper
 * nội bộ của lượt kiểm (`moderation-worker-check.ts`) và lượt quét lại
 * (`moderation-worker-rescan.ts`).
 *
 * Mỗi lệnh ghi hỏng đều được ghi log (sự kiện ổn định + loại + id) và báo cho nơi gọi
 * qua `failures` — không bao giờ nuốt im lặng (CLAUDE.md: "lỗi ẩn/ghi hàng duyệt phải log").
 */
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { affectedRowsOrZero } from '../utils/affected-rows'
import {
  aiModerationQueue,
  articleComments,
  chatMessages,
  livestreamMessages,
} from '../db/schema'
import { logError } from '../utils/logger'
import { autoHideFlagReason } from '../utils/moderation-flag-reason'
import { workerStats } from './moderation-stats'
import type { ModerationCheckInput, ModerationPersistFailure } from './moderation-worker-types'

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Lỗi ghi cũng đẩy trạng thái worker sang `degraded` — admin thấy được ở trang trạng thái. */
function noteWorkerError(err: unknown): void {
  workerStats.errorCount++
  workerStats.lastError = describeError(err)
  workerStats.lastErrorAt = new Date().toISOString()
}

type QueueRow = typeof aiModerationQueue.$inferInsert

/** Cột được ghi bởi `insertQueueRowOnce` — thứ tự khớp `queueValues`. */
const QUEUE_COLUMNS = [
  'target_type', 'target_id', 'author_name', 'author_ip', 'context_title', 'context_url',
  'session_id', 'content_snippet', 'flagged_reason', 'matched_rules', 'severity', 'status',
] as const

/**
 * Ghi một hàng chờ duyệt — trừ khi CHÍNH mục đó (cùng loại + id) đã có một hàng còn
 * chờ (`pending`). Trả `false` khi bỏ qua vì đã có.
 *
 * Trước đây mỗi lượt "Quét lại" ghi thêm một hàng `flag_only` cho MỌI bình luận còn
 * hiện khi AI chưa cấu hình (4 hàng, rồi 8…): bảng không có khoá duy nhất. Nay một
 * câu `INSERT … SELECT … WHERE NOT EXISTS` (một câu lệnh — không phải đọc rồi ghi —
 * dò bằng chỉ mục `ai_moderation_queue_target_idx`). Mục không có id (tin chatbot
 * chưa lưu) luôn được ghi. Giới hạn: không có khoá duy nhất, nên hai câu chạy ĐỒNG
 * THỜI cho cùng một mục vẫn có thể cùng ghi (quét lại và lượt đăng mới chạm cùng một
 * bình luận đúng cùng lúc — hiếm, và chỉ là một hàng chờ thừa).
 */
async function insertQueueRowOnce(row: QueueRow): Promise<boolean> {
  const db = getDb()
  if (row.targetId === null || row.targetId === undefined) {
    await db.insert(aiModerationQueue).values(row)
    return true
  }
  const values = [
    row.targetType, row.targetId, row.authorName ?? null, row.authorIp ?? null, row.contextTitle ?? null,
    row.contextUrl ?? null, row.sessionId ?? null, row.contentSnippet, row.flaggedReason,
    JSON.stringify(row.matchedRules ?? []), row.severity ?? 'high', row.status ?? 'pending',
  ]
  const [result] = await db.execute(sql`INSERT INTO ${aiModerationQueue} (${sql.join(QUEUE_COLUMNS.map(c => sql.identifier(c)), sql`, `)})
    SELECT ${sql.join(values.map(v => sql`${v}`), sql`, `)} FROM DUAL
    WHERE NOT EXISTS (SELECT 1 FROM ${aiModerationQueue} WHERE ${aiModerationQueue.targetType} = ${row.targetType} AND ${aiModerationQueue.targetId} = ${row.targetId} AND ${aiModerationQueue.status} = ${'pending'})`)
  return affectedRowsOrZero(result) > 0
}

/**
 * Ẩn bình luận / gắn cờ tin chatbot / xoá tin livestream. Trả `true` chỉ khi lệnh
 * ghi chạy xong; lỗi được ghi log với sự kiện ổn định `ai_moderation.hide_failed`
 * kèm loại + id, và thêm `'hide'` vào `failures` — không bao giờ nuốt im lặng.
 *
 * `reason` là đúng `flagged_reason` của hàng chờ duyệt cho mục này: `flag_reason` ghi
 * xuống là dấu "ẩn bởi kiểm duyệt tự động" mà lượt duyệt an toàn đối chiếu trước khi
 * hiện lại (`autoHideFlagReason`, `restoreAutoHidden`). Tin livestream có cột riêng từ
 * khi có lượt hiện lại — ẩn tay của cán bộ (`removeChatMessage`) không ghi gì vào đó.
 *
 * Chỉ ghi lên hàng còn đang hiện (`is_hidden = 0` / `is_flagged = 0` / `is_deleted = 0`):
 * lượt AI chạy nền vài giây, cán bộ có thể đã ẩn/gỡ tay trong lúc đó — ghi đè là thay lý do
 * của cán bộ bằng dấu tự động, và "Bỏ ẩn" trên hàng chờ sẽ hiện lại thứ cán bộ đã ẩn. Hàng
 * đã ẩn thì giữ nguyên dấu của lần ẩn đó; vẫn trả `true` (nội dung đang ẩn) như trước.
 */
async function applyAutoHide(
  targetType: ModerationCheckInput['targetType'],
  targetId: number,
  reason: string,
  failures: ModerationPersistFailure[],
): Promise<boolean> {
  const db = getDb()
  const flagReason = autoHideFlagReason(reason)
  try {
    if (targetType === 'comment') {
      await db
        .update(articleComments)
        .set({ isHidden: true, flagReason })
        .where(and(eq(articleComments.id, targetId), eq(articleComments.isHidden, false)))
    } else if (targetType === 'chat') {
      await db
        .update(chatMessages)
        .set({ isFlagged: true, flagReason })
        .where(and(eq(chatMessages.id, targetId), eq(chatMessages.isFlagged, false)))
    } else if (targetType === 'livestream_chat') {
      await db
        .update(livestreamMessages)
        .set({ isDeleted: true, flagReason })
        .where(and(eq(livestreamMessages.id, targetId), eq(livestreamMessages.isDeleted, false)))
    } else {
      return false // 'article': không có cột ẩn nào để đặt
    }
    return true
  } catch (err: unknown) {
    failures.push('hide')
    noteWorkerError(err)
    logError({ event: 'ai_moderation.hide_failed', targetType, targetId, error: describeError(err) })
    return false
  }
}

// Khai báo giữ nguyên văn như trước khi tách; tên được xuất ở đây cho hai tệp anh em.
export { describeError, noteWorkerError, insertQueueRowOnce, applyAutoHide }
