import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'
import { escapeHtml } from '../../../utils/escape-html'

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
    taskPrompt = `Bạn là chuyên gia biên tập và soát lỗi văn bản chính luận của Cổng thông tin Cục C11 - Bộ Công an.
Hãy đọc kỹ bài viết, rà soát từng câu từng từ để tìm:
1. Lỗi chính tả, đánh máy, danh xưng địa danh hành chính (ví dụ: huyện Mèo Vạc).
2. Lỗi ngữ pháp, dùng từ chưa chuẩn văn phong báo chí chính luận.
3. Sai số hiệu văn bản pháp luật, sai tên cơ quan hành chính (ví dụ: Nghị định về tái hòa nhập cộng đồng là Nghị định số 49/2020/NĐ-CP; Chi nhánh Ngân hàng Chính sách xã hội).

YÊU CẦU BẮT BUỘC VỀ ĐẦU RA:
Trả về đúng định dạng JSON thuần túy (không bọc trong markdown code block, không thêm lời dẫn giải thích):
{
  "summaryNotes": "Tóm tắt ngắn gọn 1-2 câu về tình trạng bài viết và những điểm chính đã sửa",
  "changes": [
    {
      "original": "Đoạn văn bản gốc có lỗi hoặc chưa chuẩn (chuỗi ngắn, chính xác để tìm và thay thế)",
      "suggested": "Đoạn văn bản đã sửa đổi, chuẩn hóa tương ứng",
      "reason": "Giải thích ngắn gọn 1 câu lỗi gì (chính tả / pháp lý / danh xưng)"
    }
  ],
  "polishedContent": "Toàn bộ nội dung bài viết hoàn chỉnh sau khi đã sửa toàn bộ lỗi (giữ nguyên cấu trúc HTML nếu có các thẻ <img>, <a>, <p>...)"
}`
  }

  // 3. Invoke AI Gateway — escape user content so a closing fence inside the article cannot be mistaken for instruction.
  const safeTitle = escapeHtml(title || '(Chưa có tiêu đề)')
  const safeRaw = escapeHtml(rawContent.slice(0, 10000))
  const aiResult = await callAi('editorial_assistant', {
    prompt: `${taskPrompt}\n\nTiêu đề bài viết: ${safeTitle}\n\nNội dung bài viết:\n${safeRaw}`,
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
    changes?: Array<{ original: string; suggested: string; reason: string }>
    summaryNotes?: string
    notes?: string[]
  } = {}

  try {
    let clean = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    const firstBrace = clean.indexOf('{')
    const lastBrace = clean.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1)
    }
    parsed = JSON.parse(clean) as typeof parsed
  } catch {
    // Cố gắng phục hồi nếu JSON bị cắt cuối (do bài viết dài chạm trần token)
    try {
      const text = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
      const changesMatch = text.match(/"changes"\s*:\s*\[([\s\S]*?)\](?:\s*,\s*"polishedContent"|\s*\})/)
      let recoveredChanges: Array<{ original: string; suggested: string; reason: string }> = []
      if (changesMatch) {
        try {
          recoveredChanges = JSON.parse(`[${changesMatch[1]}]`)
        } catch {
          const itemRegex = /\{\s*"original"\s*:\s*"([^"]*)"\s*,\s*"suggested"\s*:\s*"([^"]*)"\s*,\s*"reason"\s*:\s*"([^"]*)"\s*\}/g
          let m
          while ((m = itemRegex.exec(text)) !== null) {
            recoveredChanges.push({ original: m[1], suggested: m[2], reason: m[3] })
          }
        }
      }
      const summaryMatch = text.match(/"summaryNotes"\s*:\s*"([^"]*)"/)
      parsed = {
        summaryNotes: summaryMatch ? summaryMatch[1] : undefined,
        changes: recoveredChanges,
      }
    } catch {
      const lines = aiResult.text.split('\n').map(l => l.trim()).filter(l => l.length > 10)
      parsed = {
        options: lines.length > 0 ? lines : [aiResult.text.trim()],
      }
    }
  }

  return {
    ok: true,
    action,
    options: parsed.options || (parsed.summary ? [parsed.summary] : []),
    titles: parsed.titles || [],
    polishedContent: parsed.polishedContent || '',
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    summaryNotes: parsed.summaryNotes || (parsed.notes?.join(' • ') || ''),
    notes: parsed.notes || [],
    rawText: aiResult.text.trim(),
    usage: {
      promptTokens: aiResult.promptTokens ?? 0,
      completionTokens: aiResult.completionTokens ?? 0,
      costVnd: aiResult.costVnd ?? '0',
    },
  }
})
