import { createError } from 'h3'
import { getDb } from '../../../utils/db'
import { requireResourcePermission } from '../../../utils/permissions'
import { checkBudget } from '../../../utils/ai-budget'
import { callAi } from '../../../services/ai-gateway'

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'Tiếng Anh (English)',
  zh: 'Tiếng Trung (Chinese - 中文)',
  fr: 'Tiếng Pháp (French - Français)',
  ru: 'Tiếng Nga (Russian - Русский)',
  ja: 'Tiếng Nhật (Japanese - 日本語)',
  ko: 'Tiếng Hàn (Korean - 한국어)',
  es: 'Tiếng Tây Ban Nha (Spanish - Español)',
  de: 'Tiếng Đức (German - Deutsch)',
  lo: 'Tiếng Lào (Lao)',
  km: 'Tiếng Campuchia (Khmer)',
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const targetLangCode = String(body.targetLanguage || 'en').trim().toLowerCase()
  const targetLangName = LANGUAGE_NAMES[targetLangCode] || targetLangCode

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const rawText = typeof body.text === 'string' ? body.text.trim() : ''

  if (!title && !excerpt && !content && !rawText) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng cung cấp văn bản hoặc bài viết cần dịch.' })
  }

  const db = getDb()

  // 1. Check budget guard
  const budgetResult = await checkBudget(db, 'translation_article')
  if (!budgetResult.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: budgetResult.errorMessage ?? 'Hệ thống hết ngân sách cho AI. Vui lòng nạp thêm ngân sách.',
    })
  }

  // 2. Build translation payload
  // If translating individual text:
  if (rawText) {
    const aiResult = await callAi('translation_article', {
      prompt: `Dịch văn bản sau sang ${targetLangName}. Giữ nguyên ý nghĩa, tính trang trọng, chuẩn xác về thuật ngữ pháp lý và hành chính. Không thêm lời bình luận hay giải thích:\n\n${rawText}`,
      variables: {
        source_text: rawText,
        target_language: targetLangName,
        source_language: 'Tiếng Việt',
      },
      userId: adminUser?.id ?? null,
    })

    if (!aiResult.ok || !aiResult.text) {
      throw createError({ statusCode: 502, statusMessage: aiResult.errorMessage || 'Không thể dịch văn bản.' })
    }

    return {
      ok: true,
      targetLanguage: targetLangCode,
      targetLanguageName: targetLangName,
      translatedText: aiResult.text.trim(),
    }
  }

  // Translating an article (Title, Excerpt, Content):
  const promptParts: string[] = []
  promptParts.push(`Dịch bài viết sau sang ${targetLangName}.
Yêu cầu bắt buộc:
1. Chuẩn xác thuật ngữ pháp lý và hành chính nhà nước.
2. Giữ nguyên 100% các thẻ định dạng HTML (<p>, <strong>, <em>, <a>, <img>, <ul>, <ol>, <li>, <h3>, <h4>...) trong phần nội dung, CHỈ dịch phần văn bản bên trong.
3. Trả về kết quả theo đúng cấu trúc JSON sau (không bọc trong markdown code block, chỉ trả về JSON thuần):
{
  "translatedTitle": "...",
  "translatedExcerpt": "...",
  "translatedContent": "..."
}`)

  if (title) promptParts.push(`[TIÊU ĐỀ GỐC]:\n${title}`)
  if (excerpt) promptParts.push(`[TÓM TẮT GỐC]:\n${excerpt}`)
  if (content) promptParts.push(`[NỘI DUNG GỐC]:\n${content.slice(0, 12000)}`)

  const aiResult = await callAi('translation_article', {
    prompt: promptParts.join('\n\n'),
    variables: {
      source_text: `${title}\n${excerpt}\n${content.slice(0, 4000)}`,
      target_language: targetLangName,
      source_language: 'Tiếng Việt',
    },
    userId: adminUser?.id ?? null,
  })

  if (!aiResult.ok || !aiResult.text) {
    throw createError({ statusCode: 502, statusMessage: aiResult.errorMessage || 'Không thể dịch bài viết.' })
  }

  // Parse JSON from AI response
  let parsedJson: { translatedTitle?: string; translatedExcerpt?: string; translatedContent?: string } = {}
  try {
    const raw = aiResult.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    parsedJson = JSON.parse(raw) as typeof parsedJson
  } catch {
    // If not strict JSON, use text as translatedContent
    parsedJson = {
      translatedTitle: title ? `[${targetLangCode.toUpperCase()}] ${title}` : '',
      translatedExcerpt: excerpt,
      translatedContent: aiResult.text.trim(),
    }
  }

  return {
    ok: true,
    targetLanguage: targetLangCode,
    targetLanguageName: targetLangName,
    translatedTitle: parsedJson.translatedTitle || '',
    translatedExcerpt: parsedJson.translatedExcerpt || '',
    translatedContent: parsedJson.translatedContent || '',
    usage: {
      promptTokens: aiResult.promptTokens ?? 0,
      completionTokens: aiResult.completionTokens ?? 0,
      costVnd: aiResult.costVnd ?? '0',
    },
  }
})
