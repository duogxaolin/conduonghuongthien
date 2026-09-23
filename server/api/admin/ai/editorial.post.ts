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

  // 2. Build task-specific prompt
  let taskPrompt = ''
  if (action === 'summary') {
    taskPrompt = `Hãy viết một đoạn tóm tắt bài viết (sapo) khoảng 2 đến 3 câu ngắn gọn, súc tích (dưới 80 từ), nêu bật thông điệp chính và ý nghĩa của bài viết. Không mở đầu bằng "Bài viết nói về..." hay "Đoạn văn này...", hãy viết trực diện và trang trọng theo văn phong báo chí chính luận.`
  } else if (action === 'suggest_titles') {
    taskPrompt = `Hãy đọc nội dung bài viết và đề xuất 3 phương án tiêu đề bài viết hấp dẫn, trang trọng, chuẩn mực theo tôn chỉ mục đích của Cổng thông tin Cục C11 - Bộ Công an. Trình bày mỗi tiêu đề trên một dòng riêng biệt, đánh số 1., 2., 3.`
  } else if (action === 'polish') {
    taskPrompt = `Hãy rà soát toàn bộ bài viết, sửa các lỗi chính tả, ngữ pháp, lỗi dùng từ, và diễn đạt lại các câu văn sao cho mạch lạc, trong sáng, trang trọng và giàu tính nhân văn. Giữ nguyên ý chính và các số liệu, trích dẫn văn bản quy phạm pháp luật nếu có.`
  }

  // 3. Invoke AI Gateway
  const aiResult = await callAi('editorial_assistant', {
    prompt: `${taskPrompt}\n\nTiêu đề bài viết: ${title || '(Chưa có tiêu đề)'}\n\nNội dung bài viết:\n${content.slice(0, 10000)}`,
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

  return {
    ok: true,
    action,
    result: aiResult.text.trim(),
    usage: {
      promptTokens: aiResult.promptTokens ?? 0,
      completionTokens: aiResult.completionTokens ?? 0,
      costVnd: aiResult.costVnd ?? '0',
    },
  }
})
