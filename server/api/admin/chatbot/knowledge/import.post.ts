import { requireChatbotKnowledgePermission } from '../../../../utils/permissions'
import { createKnowledge, transitionKnowledge, ChatbotKnowledgeValidationError } from '../../../../services/chatbot-knowledge'
import { extractKeywords } from '../../../../utils/chatbot/keywords'
import { parseQaWorkbookDiagnostics, XlsxError, type QaParseIssue, type QaRawRow, type QaRow } from '../../../../utils/xlsx-reader'
import { logError } from '../../../../utils/logger'

const MAX_FILE_BYTES = 8 * 1024 * 1024 // 8 MB
const MAX_ROWS = 2000
const RAW_LIMITS = { stt: 120, question: 1000, answer: 4000, note: 512 } as const
const RAW_EXTRA_LIMITS = { columns: 32, value: 512 } as const

type ImportStage = 'parse' | 'save' | 'publish'
type ImportError = {
  stage: ImportStage
  row: number
  endRow: number
  code: string
  message: string
  raw: QaRawRow
  truncatedFields: string[]
}

function previewRaw(raw: QaRawRow): Pick<ImportError, 'raw' | 'truncatedFields'> {
  const truncatedFields: string[] = []
  const preview = {} as QaRawRow
  for (const field of ['stt', 'question', 'answer', 'note'] as const) {
    const value = raw[field] || ''
    const limit = RAW_LIMITS[field]
    if (value.length > limit) {
      preview[field] = `${value.slice(0, limit)}…`
      truncatedFields.push(field)
    } else preview[field] = value
  }
  if (raw.rawExtraColumns?.length) {
    preview.rawExtraColumns = raw.rawExtraColumns.slice(0, RAW_EXTRA_LIMITS.columns).map((item, index) => {
      if (item.value.length <= RAW_EXTRA_LIMITS.value) return item
      truncatedFields.push(`rawExtraColumns.${index}.value`)
      return { column: item.column, value: `${item.value.slice(0, RAW_EXTRA_LIMITS.value)}…` }
    })
    if (raw.rawExtraColumns.length > RAW_EXTRA_LIMITS.columns) truncatedFields.push('rawExtraColumns')
  }
  return { raw: preview, truncatedFields }
}

function safeValidationMessage(message: string): { code: string; message: string } {
  const known: Array<[RegExp, string, string]> = [
    [/canonicalQuestion is required/, 'missing_question', 'Thiếu Câu hỏi.'],
    [/approvedAnswer is required/, 'missing_answer', 'Thiếu Trả lời.'],
    [/canonicalQuestion exceeds (\d+) characters/, 'question_too_long', 'Câu hỏi vượt quá giới hạn cho phép.'],
    [/approvedAnswer exceeds (\d+) characters/, 'answer_too_long', 'Trả lời vượt quá giới hạn cho phép.'],
    [/topic exceeds (\d+) characters/, 'topic_too_long', 'Chủ đề vượt quá giới hạn cho phép.'],
    [/sourceLabel exceeds (\d+) characters/, 'source_too_long', 'Nguồn vượt quá giới hạn cho phép.'],
    [/sourceReference exceeds (\d+) characters/, 'source_reference_too_long', 'Ghi chú/Tham chiếu nguồn vượt quá giới hạn cho phép.'],
    [/published knowledge requires source metadata/, 'missing_source', 'Mục xuất bản phải có nguồn tham khảo.'],
  ]
  for (const [pattern, code, localized] of known) if (pattern.test(message)) return { code, message: localized }
  return { code: 'validation_error', message: 'Dữ liệu không hợp lệ.' }
}

function issue(stage: ImportStage, row: number, endRow: number, code: string, message: string, raw: QaRawRow): ImportError {
  return { stage, row, endRow, code, message, ...previewRaw(raw) }
}

function rawForRow(row: QaRow): QaRawRow {
  return { stt: row.stt, question: row.question, answer: row.answer, note: row.note }
}

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

  let diagnostics: ReturnType<typeof parseQaWorkbookDiagnostics>
  try {
    diagnostics = parseQaWorkbookDiagnostics(fileItem.data)
  } catch (error) {
    if (error instanceof XlsxError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw createError({ statusCode: 400, statusMessage: 'Không đọc được tệp. Hãy dùng định dạng .xlsx hoặc .csv.' })
  }

  const rows = diagnostics.rows
  const errors: ImportError[] = diagnostics.issues.map((item: QaParseIssue) => issue('parse', item.row, item.endRow, item.code, item.message, item.raw))
  if (diagnostics.scannedRows > MAX_ROWS) throw createError({ statusCode: 400, statusMessage: `Tệp có quá nhiều dòng dữ liệu (tối đa ${MAX_ROWS}).` })
  const total = rows.length + diagnostics.issues.length

  let imported = 0
  let published = 0
  for (const row of rows) {
    const question = row.question
    const rowNumber = row.sourceRow || 0
    const endRow = row.sourceEndRow || rowNumber
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
        try {
          await transitionKnowledge(actor.id, Number(entry.id), 'published')
          published++
        } catch (error) {
          const detail = error instanceof ChatbotKnowledgeValidationError ? safeValidationMessage(error.message) : { code: 'publish_error', message: 'Đã nhập bản nháp nhưng không thể xuất bản do lỗi hệ thống.' }
          if (!(error instanceof ChatbotKnowledgeValidationError)) logError({ event: 'chatbot.knowledge_import_failed', stage: 'publish', actorId: actor.id, row: rowNumber, error })
          errors.push(issue('publish', rowNumber, endRow, detail.code, detail.message, rawForRow(row)))
        }
      }
    } catch (error) {
      const detail = error instanceof ChatbotKnowledgeValidationError ? safeValidationMessage(error.message) : { code: 'save_error', message: 'Không thể lưu dòng do lỗi hệ thống.' }
      if (!(error instanceof ChatbotKnowledgeValidationError)) logError({ event: 'chatbot.knowledge_import_failed', stage: 'save', actorId: actor.id, row: rowNumber, error })
      errors.push(issue('save', rowNumber, endRow, detail.code, detail.message, rawForRow(row)))
    }
  }

  return { ok: true, total, imported, published, skipped: Math.max(0, total - imported), errors: errors.slice(0, MAX_ROWS) }
})
