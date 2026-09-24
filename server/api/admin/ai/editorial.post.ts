import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'

const VALID_ACTIONS = new Set(['summary', 'suggest_titles', 'polish'])

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const action = String(body.action || '').trim()
  if (!VALID_ACTIONS.has(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Hành động không hợp lệ. Chọn summary, suggest_titles hoặc polish.' })
  }

  const title = String(body.title || '').trim()
  const rawContent = String(body.content || '').trim()
  const content = stripHtml(rawContent)

  if (!content && !title) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng cung cấp nội dung hoặc tiêu đề bài viết.' })
  }

  const db = getDb()

  // 1. Check budget guard
  const budgetResult = await checkBudget(db, 'editorial_assistant')
  if (!budgetResult.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.',
    })
  }

  // 2. Build task-specific prompt with strict JSON output
  let taskPrompt = ''
  if (action === 'summary') {
    taskPrompt = `Bạn là trợ lý biên tập của Cổng thông tin Cục C11 - Bộ Công an.
Hãy đọc bài viết và đề xuất 3 phương án viết đoạn Tóm tắt bài viết (sapo).
YÊU CẦU BẮT BUỘC:
1. TUYỆT ĐỐI KHÔNG chào hỏi (không "Chào bạn..."), không thưa gửi, không thêm ghi chú hay lời bình ở cuối.
2. Mỗi phương án là 1 đoạn văn hoàn chỉnh (2-3 câu, dưới 80 từ), viết trực diện, trang trọng theo văn phong báo chí chính luận.
3. Trả về đúng định dạng JSON thuần túy (không bọc trong markdown code block):
{
  "options": [
    "Đoạn tóm tắt theo phương án 1 (Trực diện, thời sự)...",
    "Đoạn tóm tắt theo phương án 2 (Nhân văn, sâu sắc)...",
    "Đoạn tóm tắt theo phương án 3 (Ngắn gọn, súc tích)..."
  ]
}`
  } else if (action === 'suggest_titles') {
    taskPrompt = `Bạn là trợ lý biên tập của Cổng thông tin Cục C11 - Bộ Công an.
Hãy đọc bài viết và đề xuất 3 phương án tiêu đề bài viết hấp dẫn, trang trọng, chuẩn mực chính luận.
YÊU CẦU BẮT BUỘC:
1. TUYỆT ĐỐI KHÔNG chào hỏi, không thêm lời dẫn hay giải thích.
2. Trả về đúng định dạng JSON thuần túy (không bọc trong markdown code block):
{
  "titles": [
    "Tiêu đề phương án 1",
    "Tiêu đề phương án 2",
    "Tiêu đề phương án 3"
  ]
}`
  } else if (action === 'polish') {
    taskPrompt = `Bạn là trợ lý biên tập của Cổng thông tin Cục C11 - Bộ Công an.
Hãy rà soát toàn bộ bài viết, sửa các lỗi chính tả, ngữ pháp, chuẩn hóa câu từ hành chính pháp lý.
YÊU CẦU BẮT BUỘC:
1. TUYỆT ĐỐI KHÔNG chào hỏi, không thêm lời dẫn hay ghi chú giải thích.
2. Giữ nguyên 100% các thẻ HTML (<p>, <strong>, <em>, <a>, <img>...) và ý nghĩa bài viết.
3. Trả về đúng định dạng JSON thuần túy (không bọc trong markdown code block):
{
  "polishedContent": "Toàn bộ nội dung bài viết hoàn chỉnh đã sửa lỗi",
  "notes": ["Tóm tắt ngắn 1 câu những điểm đã sửa hoặc cải thiện"]
}`
  }

  // 3. Invoke AI Gateway
  const aiResult = await callAi('editorial_assistant', {
    prompt: `${taskPrompt}\n\nTiêu đề bài viết: ${title || '(Chưa có tiêu đề)'}\n\nNội dung bài viết:\n${rawContent.slice(0, 10000)}`,
    variables: {
      article_title: title || '(Chưa có tiêu đề)',
      article_content: content.slice(0, 8000),
    },
    userId: adminUser?.id ?? null,
  })

  if (!aiResult.ok || !aiResult.text) {
    throw createError({
      statusCode: 502,
      statusMessage: aiResult.errorMessage || 'Không thể tạo phản hồi từ trợ lý AI.',
    })
  }

  // Parse structured JSON
  let parsed: {
    options?: string[]
    titles?: string[]
    summary?: string
    polishedContent?: string
    notes?: string[]
  } = {}

  try {
    const clean = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    parsed = JSON.parse(clean) as typeof parsed
  } catch {
    // If not JSON, split by lines or use raw text
    const lines = aiResult.text.split('\n').map(l => l.trim()).filter(l => l.length > 10)
    parsed = {
      options: lines.length > 0 ? lines : [aiResult.text.trim()],
    }
  }

  return {
    ok: true,
    action,
    options: parsed.options || (parsed.summary ? [parsed.summary] : []),
    titles: parsed.titles || [],
    polishedContent: parsed.polishedContent || '',
    notes: parsed.notes || [],
    rawText: aiResult.text.trim(),
    usage: {
      promptTokens: aiResult.promptTokens ?? 0,
      completionTokens: aiResult.completionTokens ?? 0,
      costVnd: aiResult.costVnd ?? '0',
    },
  }
})
