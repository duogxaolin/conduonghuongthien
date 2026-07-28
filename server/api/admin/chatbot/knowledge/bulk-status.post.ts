import { transitionKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { parseBulkIds, runBulk } from '../../../../utils/bulk'

/**
 * Publish or archive several knowledge entries in one request.
 *
 * Archiving is what "hide" means here: the retrieval path only reads `published`
 * rows, so an archived entry stops answering visitors immediately.
 *
 * Routed through `transitionKnowledge` rather than a bulk UPDATE so the existing
 * lifecycle rules still hold per row — publishing an entry with no answer or no
 * source metadata is refused, and the reviewer/timestamp columns get stamped.
 * The permission is chosen by target, matching the single-row publish/archive
 * routes: an editor with archive rights but no publish rights cannot publish.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const target = String(body?.status || '')
  if (target !== 'published' && target !== 'archived') {
    throw createError({ statusCode: 400, statusMessage: 'Trạng thái cần đặt không hợp lệ.' })
  }

  const actor = requireChatbotKnowledgePermission(event, target === 'published' ? 'publish' : 'archive')
  const ids = parseBulkIds(body)

  return runBulk(ids, async (id) => {
    try {
      if (!await transitionKnowledge(actor.id, id, target)) {
        throw createError({ statusCode: 404, statusMessage: 'Mục kiến thức không tồn tại.' })
      }
    } catch (error) {
      // A lifecycle rule reads as a 400 to the operator, not a 500.
      if (error instanceof ChatbotKnowledgeValidationError) {
        throw createError({ statusCode: 400, statusMessage: error.message })
      }
      throw error
    }
  }, target === 'published' ? 'Không thể xuất bản mục này.' : 'Không thể lưu trữ mục này.')
})
