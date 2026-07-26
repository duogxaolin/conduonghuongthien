import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { createKnowledge, transitionKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { extractKeywords } from '../../../../utils/chatbot/keywords'
import { parseQaWorkbook, XlsxError, type QaRow } from '../../../../utils/xlsx-reader'

const MAX_FILE_BYTES = 8 * 1024 * 1024 // 8 MB
const MAX_ROWS = 2000

/**
 * Bulk import a Q&A knowledge sheet (.xlsx or .csv) — columns STT / Câu hỏi /
 * Trả lời / Ghi chú. Each row becomes a chatbot_knowledge entry with keyword
 * terms auto-extracted from the question, so casual phrasings still match.
 *
 * Entries are created as DRAFT (review workflow). Passing publish=true also
 * publishes them and requires the publish permission + a source label.
 */
export default defineEventHandler(async (event) => {
  const actor = requireChatbotKnowledgePermission(event, 'create')

  const form = await readMultipartFormData(event)
  if (!form || form.length === 0) throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy tệp tải lên.' })

  const fileItem = form.find(f => f.name === 'file' && f.data) || form.find(f => f.filename && f.data)
  if (!fileItem || !fileItem.data) throw createError({ statusCode: 400, statusMessage: 'Tệp không hợp lệ.' })
  if (fileItem.data.length > MAX_FILE_BYTES) throw createError({ statusCode: 413, statusMessage: 'Tệp vượt quá giới hạn 8 MB.' })

  const field = (name: string) => form.find(f => f.name === name)?.data?.toString('utf8').trim() || ''
  const publish = ['1', 'true', 'on', 'yes'].includes(field('publish').toLowerCase())
  const topic = (field('topic') || 'general').slice(0, 128)
  const sourceLabel = (field('sourceLabel') || 'Tài liệu Hỏi – Đáp').slice(0, 255)

  if (publish) requireChatbotKnowledgePermission(event, 'publish')

  let rows: QaRow[]
  try {
    rows = parseQaWorkbook(fileItem.data)
  } catch (error) {
    if (error instanceof XlsxError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw createError({ statusCode: 400, statusMessage: 'Không đọc được tệp. Hãy dùng định dạng .xlsx hoặc .csv.' })
  }

  if (rows.length === 0) throw createError({ statusCode: 400, statusMessage: 'Không tìm thấy dòng dữ liệu hợp lệ (cần cột "Câu hỏi" và "Trả lời").' })
  if (rows.length > MAX_ROWS) throw createError({ statusCode: 400, statusMessage: `Tệp có quá nhiều dòng (tối đa ${MAX_ROWS}).` })

  let imported = 0
  let published = 0
  const errors: Array<{ row: number; message: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const question = row.question.slice(0, 1000)
    try {
      const entry = await createKnowledge(actor.id, {
        canonicalQuestion: question,
        approvedAnswer: row.answer,
        topic,
        keywords: extractKeywords(question),
        sourceLabel,
        sourceReference: row.note || null,
      })
      imported++
      if (publish && entry) {
        await transitionKnowledge(actor.id, Number(entry.id), 'published')
        published++
      }
    } catch (error) {
      const message = error instanceof ChatbotKnowledgeValidationError ? error.message : 'Lỗi khi lưu dòng.'
      errors.push({ row: i + 1, message })
    }
  }

  return { ok: true, total: rows.length, imported, published, skipped: errors.length, errors: errors.slice(0, 20) }
})
