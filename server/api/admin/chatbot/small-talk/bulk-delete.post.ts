import { deleteSmallTalk, ChatbotSmallTalkValidationError } from '../../../../services/chatbot-small-talk'
import { requireChatbotSmallTalkPermission } from '../../../../utils/permissions'
import { parseBulkIds, runBulk } from '../../../../utils/bulk'

/**
 * Delete several everyday-reply entries in one request.
 *
 * System rows are refused per row (deleteSmallTalk throws), so a lot that mixes
 * system and custom rows removes the custom ones and reports the system ones as
 * failures — the partial-success contract every other bulk route follows.
 */
export default defineEventHandler(async (event) => {
  const actor = requireChatbotSmallTalkPermission(event, 'delete')
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))

  return runBulk(ids, async (id) => {
    try {
      if (!await deleteSmallTalk(actor.id, id)) {
        throw createError({ statusCode: 404, statusMessage: 'Mục trả lời thường nhật không tồn tại.' })
      }
    } catch (error) {
      if (error instanceof ChatbotSmallTalkValidationError) throw createError({ statusCode: 400, statusMessage: error.message })
      throw error
    }
  }, 'Không thể xóa mục này.')
})
