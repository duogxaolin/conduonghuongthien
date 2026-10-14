import { createError, setResponseStatus } from 'h3'
import { requireResourcePermission } from '../../../../utils/permissions'
import { startModerationRescan } from '../../../../services/moderation-rescan-job'
import { getDb } from '../../../../utils/db'
import { activityLogs } from '../../../../db/schema'
import { logError } from '../../../../utils/logger'

/**
 * Bắt đầu lượt "Quét & dọn sạch nội dung cũ" ở NỀN và trả 202 ngay.
 *
 * Lượt quét từng chạy đồng bộ trong request (mỗi bình luận một lượt AI, không giới
 * hạn, không khoá) — proxy cắt request trong khi vòng lặp vẫn chạy, và bấm lần hai
 * là nhân đôi chi phí AI. Nay job giữ khoá đơn luồng; bấm khi đang chạy nhận 409
 * kèm tiến độ. Tiến độ theo dõi qua `worker-status` (`rescan`).
 *
 * Kiểm toán: một dòng lúc BẮT ĐẦU (hành động của cán bộ) và một dòng lúc XONG kèm
 * tổng kết (qua `onFinished`). Mỗi dòng là lượt ghi duy nhất của nó — không có hàng
 * nghiệp vụ nào cùng commit để bọc transaction. Ghi hỏng thì ghi log, không im lặng.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')
  const actorId: number | null = adminUser?.id ?? null

  const writeAudit = async (meta: Record<string, unknown>) => {
    try {
      await getDb().insert(activityLogs).values({
        userId: actorId,
        action: 'update',
        resource: 'ai',
        meta,
      })
    } catch (err: unknown) {
      logError({
        event: 'ai_moderation.rescan_audit_failed',
        operation: meta.operation,
        actorId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const outcome = await startModerationRescan({
    actorId,
    onFinished: summary => writeAudit({ operation: 'moderation_rescan_all', ...summary }),
  })

  if (!outcome.started) {
    throw createError({
      statusCode: 409,
      statusMessage: outcome.reason === 'running_here'
        ? 'Đang có một lượt quét lại chạy. Vui lòng đợi lượt đó hoàn tất.'
        : 'Đang có một lượt quét lại chạy trên máy chủ khác. Vui lòng đợi lượt đó hoàn tất.',
      data: { rescan: outcome.status },
    })
  }

  await writeAudit({ operation: 'moderation_rescan_all_started', limits: outcome.status.limits })

  setResponseStatus(event, 202)
  return {
    ok: true,
    started: true,
    rescan: outcome.status,
    message: 'Đã bắt đầu quét lại nội dung ở nền. Tiến độ cập nhật trên trang này.',
  }
})
