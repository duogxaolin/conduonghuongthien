import { deleteKnowledge } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { parseBulkIds, runBulk } from '../../../../utils/bulk'

/**
 * Delete several knowledge entries in one request.
 *
 * `deleteKnowledge` already writes one audit row per entry and reports a missing
 * row by returning false, which is turned into a per-row failure here so the rest
 * of the lot still goes through.
 */
export default defineEventHandler(async (event) => {
  const actor = requireChatbotKnowledgePermission(event, 'delete')
  const ids = parseBulkIds(await readBody(event).catch(() => ({})))

  return runBulk(ids, async (id) => {
    if (!await deleteKnowledge(actor.id, id)) {
      throw createError({ statusCode: 404, statusMessage: 'Mục kiến thức không tồn tại.' })
    }
  }, 'Không thể xóa mục kiến thức này.')
})
