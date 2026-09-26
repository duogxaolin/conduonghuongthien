import { createError } from 'h3'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../../../utils/db'
import { articleComments, readerAccounts } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'

interface ModerationResult {
  id?: number
  content: string
  author?: string
  verdict: 'safe' | 'spam' | 'violation'
  riskLevel: 'low' | 'medium' | 'high'
  flags: string[]
  reason: string
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'comments', 'read')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const commentIds = Array.isArray(body.commentIds)
    ? (body.commentIds as unknown[]).map(Number).filter((n: number): n is number => Number.isFinite(n) && n > 0).slice(0, 10)
    : []

  const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
  const rawAuthor = typeof body.author === 'string' ? body.author.trim() : ''

  if (commentIds.length === 0 && !rawContent) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng cung cấp nội dung hoặc danh sách ID bình luận cần kiểm duyệt.' })
  }

  const db = getDb()

  // 1. Check budget guard
  const budgetResult = await checkBudget(db, 'moderation')
  if (!budgetResult.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.',
    })
  }

  // 2. Fetch comments if IDs provided
  const itemsToModerate: Array<{ id?: number; content: string; author: string }> = []

  if (commentIds.length > 0) {
    const rows = await db
      .select({
        id: articleComments.id,
        body: articleComments.body,
        displayName: readerAccounts.displayName,
        customDisplayName: readerAccounts.customDisplayName,
      })
      .from(articleComments)
      .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
      .where(inArray(articleComments.id, commentIds))

    for (const r of rows) {
      itemsToModerate.push({
        id: r.id,
        content: r.body,
        author: r.customDisplayName || r.displayName || 'Người đọc',
      })
    }
  } else if (rawContent) {
    itemsToModerate.push({
      content: rawContent,
      author: rawAuthor || 'Khách',
    })
  }

  if (itemsToModerate.length === 0) {
    return { ok: true, results: [] }
  }

  // 3. Process moderation via AI Gateway
  const results: ModerationResult[] = []

  for (const item of itemsToModerate) {
    const prompt = `Kiểm duyệt nội dung bình luận sau trên Cổng thông tin điện tử Cục C11 - Bộ Công an:
Người gửi: ${item.author}
Nội dung: "${item.content}"

Yêu cầu phân tích:
1. Phát hiện: ngôn từ thù ghét, chống phá, kích động, xúc phạm nhân phẩm, từ ngữ thô tục, quảng cáo, cờ bạc, lừa đảo hoặc thông tin sai sự thật.
2. Trả về đúng định dạng JSON sau (không kèm markdown code block):
{
  "verdict": "safe" | "spam" | "violation",
  "riskLevel": "low" | "medium" | "high",
  "flags": ["lý do ngắn gọn nếu có"],
  "reason": "Giải thích ngắn gọn 1 câu bằng tiếng Việt"
}`

    try {
      const aiResult = await callAi('moderation', {
        prompt,
        variables: {
          content: item.content.slice(0, 1000),
          author: item.author.slice(0, 100),
        },
        userId: adminUser?.id ?? null,
      })

      if (aiResult.ok && aiResult.text) {
        let parsed: { verdict?: string; riskLevel?: string; flags?: string[]; reason?: string } = {}
        try {
          const raw = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
          parsed = JSON.parse(raw) as typeof parsed
        } catch {
          parsed = { verdict: 'safe', riskLevel: 'low', flags: [], reason: 'Không có dấu hiệu vi phạm rõ ràng.' }
        }

        const validVerdict = ['safe', 'spam', 'violation'].includes(parsed.verdict || '') ? (parsed.verdict as 'safe' | 'spam' | 'violation') : 'safe'
        const validRisk = ['low', 'medium', 'high'].includes(parsed.riskLevel || '') ? (parsed.riskLevel as 'low' | 'medium' | 'high') : 'low'

        results.push({
          id: item.id,
          content: item.content,
          author: item.author,
          verdict: validVerdict,
          riskLevel: validRisk,
          flags: Array.isArray(parsed.flags) ? parsed.flags : [],
          reason: parsed.reason || 'Bình luận hợp lệ.',
        })
      } else {
        results.push({
          id: item.id,
          content: item.content,
          author: item.author,
          verdict: 'safe',
          riskLevel: 'low',
          flags: [],
          reason: 'Không thể phân tích bằng AI.',
        })
      }
    } catch {
      results.push({
        id: item.id,
        content: item.content,
        author: item.author,
        verdict: 'safe',
        riskLevel: 'low',
        flags: [],
        reason: 'Lỗi trong quá trình kiểm duyệt AI.',
      })
    }
  }

  return {
    ok: true,
    count: results.length,
    results,
  }
})
