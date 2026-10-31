import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'
import { decodeHtmlEntities } from '../../../utils/decode-html-entities'
import { sanitizeHtml } from '../../../utils/sanitize-html'

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
  // stripHtml removes tags but leaves HTML entities (`&acirc;` etc.). TinyMCE emits
  // Vietnamese diacritics as named entities; decode them so the AI sees real characters
  // and echoes them back identically (otherwise Vue text interpolation renders `&acirc;`).
  const content = decodeHtmlEntities(stripHtml(rawContent))
  const decodedTitle = decodeHtmlEntities(title)

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
1. Lỗi chính tả, đánh máy, viết hoa/sai thông thường.
2. Lỗi ngữ pháp, dùng từ chưa chuẩn văn phong báo chí chính luận.

KHÔNG ĐƯỢC soi các lỗi sau (vì bạn KHÔNG có thông tin chính xác để kết luận):
- Địa danh hành chính (tỉnh/huyện/xã, trực thuộc tỉnh nào). Địa danh Việt Nam thay đổi liên tục, bài viết có thể đã dùng tên mới — KHÔNG báo lỗi địa danh.
- Thời gian, ngày tháng, năm (kể cả năm tương lai). Bạn không biết ngày biên tập hay ngày sự kiện thật — KHÔNG báo lỗi "năm ở tương lai".
- Tên cơ quan, số hiệu văn bản pháp luật, điều khoản luật. Bạn không có cơ sở dữ liệu pháp luật cập nhật — KHÔNG báo lỗi "điều không tồn tại" hoặc "luật chưa ban hành".

YÊU CẦU BẮT BUỘC VỀ ĐẦU RA:
Trả về đúng định dạng JSON thuần túy (không bọc trong markdown code block, không thêm lời dẫn giải thích):
{
  "summaryNotes": "Tóm tắt ngắn gọn 1-2 câu về tình trạng bài viết và những điểm chính đã sửa",
  "changes": [
    {
      "original": "Đoạn văn bản gốc có lỗi hoặc chưa chuẩn (chuỗi ngắn, chính xác để tìm và thay thế)",
      "suggested": "Đoạn văn bản đã sửa đổi, chuẩn hóa tương ứng",
      "reason": "Giải thích ngắn gọn 1 câu lỗi gì (chính tả / ngữ pháp / văn phong)"
    }
  ],
  "polishedContent": "Toàn bộ nội dung bài viết hoàn chỉnh sau khi đã sửa toàn bộ lỗi (giữ nguyên cấu trúc HTML nếu có các thẻ <img>, <a>, <p>...)"
}`
  }

  // 3. Invoke AI Gateway. `content` has had HTML tags stripped and named entities
  //    decoded so Vietnamese diacritics reach the model as real Unicode characters
  //    (TinyMCE emits `ấ` as `&acirc;`; decoding prevents the model from echoing the
  //    literal entity into `original`/`suggested`, which Vue text interpolation would
  //    render as `&acirc;`). We deliberately do NOT escapeHtml here — it would re-mangle
  //    the diacritics, and it does not guard against markdown-fence prompt injection
  //    (backtick is not an HTML metacharacter). The article is staff-written and goes in
  //    unfenced, and `variables` are substituted raw into a stored system prompt
  //    (`substituteVariables` adds no fence); what protects the officer is the server-side
  //    sanitising of everything the model returns, below.
  const aiResult = await callAi('editorial_assistant', {
    prompt: `${taskPrompt}\n\nTiêu đề bài viết: ${decodedTitle || '(Chưa có tiêu đề)'}\n\nNội dung bài viết:\n${content.slice(0, 10000)}`,
    variables: {
      article_title: decodedTitle || '(Chưa có tiêu đề)',
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
          let m: RegExpExecArray | null
          while ((m = itemRegex.exec(text)) !== null) {
            if (m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
              recoveredChanges.push({ original: m[1], suggested: m[2], reason: m[3] })
            }
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

  // Model output is untrusted (the article text it read can carry a prompt
  // injection). `polishedContent` is rendered with v-html in ArticleAIPanel and
  // both it and `changes[].suggested` are written into the TinyMCE editor, so each
  // goes through the same allowlist sanitizer as a stored article body. When the
  // model returned neither a polished body nor a change list, the raw reply is the
  // only thing to show — it is sanitized too, here, so the client never has to
  // fall back to `rawText` for HTML.
  const changes = Array.isArray(parsed.changes)
    ? parsed.changes
        .filter(c => c && typeof c === 'object')
        .map(c => ({
          original: String(c.original ?? ''),
          suggested: sanitizeHtml(String(c.suggested ?? '')),
          reason: String(c.reason ?? ''),
        }))
    : []
  const polishedSource = parsed.polishedContent
    || (action === 'polish' && changes.length === 0 ? aiResult.text.trim() : '')

  return {
    ok: true,
    action,
    options: parsed.options || (parsed.summary ? [parsed.summary] : []),
    titles: parsed.titles || [],
    polishedContent: sanitizeHtml(polishedSource),
    changes,
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
