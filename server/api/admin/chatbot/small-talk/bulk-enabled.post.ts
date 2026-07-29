import { setSmallTalkEnabled } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'
import { parseBulkIds, runBulk } from '../../../../utils/bulk'

/**
 * Enable or disable several everyday-reply entries in one request.
 *
 * Toggling is an `update` on this store (no publish lifecycle), so it is gated
 * on the `update` action. System rows can be toggled — only deletion is blocked.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  if (typeof body?.isEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu trạng thái bật/tắt.' })
  }
  const isEnabled = body.isEnabled as boolean

  const actor = requireChatbotSmallTalkPermission(event, 'update')
  const ids = parseBulkIds(body)

  return runBulk(ids, async (id) => {
    if (!await setSmallTalkEnabled(actor.id, id, isEnabled)) {
      throw createError({ statusCode: 404, statusMessage: 'Mục trả lời thường nhật không tồn tại.' })
    }
  }, isEnabled ? 'Không thể bật mục này.' : 'Không thể tắt mục này.')
})
