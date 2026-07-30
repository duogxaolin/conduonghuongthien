import { updateKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { parseBulkIds, runBulk } from '../../../../utils/bulk'

/**
 * Add or remove several knowledge entries from the widget's quick-question strip.
 *
 * Routed through `updateKnowledge` rather than a bulk UPDATE so the existing
 * rules still hold per row: a published entry that lost its source metadata is
 * refused instead of being silently rewritten, and every row gets its own audit
 * line. The flag alone does not publish anything — the public endpoint reads
 * `status = 'published' AND is_quick_question = 1`, so flagging a draft only
 * queues it for when the draft is published.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  if (typeof body?.isQuickQuestion !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Giá trị câu hỏi nhanh không hợp lệ.' })
  }

  const actor = requireChatbotKnowledgePermission(event, 'update')
  const ids = parseBulkIds(body)
  const target = body.isQuickQuestion === true

  return runBulk(ids, async (id) => {
    try {
      if (!await updateKnowledge(actor.id, id, { isQuickQuestion: target })) {
        throw createError({ statusCode: 404, statusMessage: 'Mục kiến thức không tồn tại.' })
      }
    } catch (error) {
      if (error instanceof ChatbotKnowledgeValidationError) {
        throw createError({ statusCode: 400, statusMessage: error.message })
      }
      throw error
    }
  }, target ? 'Không thể đưa mục này vào câu hỏi nhanh.' : 'Không thể bỏ mục này khỏi câu hỏi nhanh.')
})
