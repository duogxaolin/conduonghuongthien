/**
 * Article translation worker — chạy một job dịch (tiêu đề/tóm tắt + từng đoạn HTML)
 * qua AI gateway, cập nhật tiến độ trong `article_translations`.
 * Tách nguyên văn từ article-translations.ts; module cũ re-export để import không đổi.
 */
import { eq, and } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { articleTranslations, articles } from '../db/schema'
import { chunkHtml } from '../utils/html-chunker'
import { callAi } from './ai-gateway'
import { checkBudget } from '../utils/ai-budget'
import { logInfo, logWarn } from '../utils/logger'

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese (中文)',
  fr: 'French (Français)',
  ru: 'Russian (Русский)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  lo: 'Lao',
  km: 'Khmer',
}
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}
export function parseTitleAndExcerpt(
  rawText: string,
  originalTitle = '',
  originalExcerpt = '',
): { title: string; excerpt: string } {
  let title = ''
  let excerpt = ''

  if (!rawText || !rawText.trim()) {
    return { title: '', excerpt: '' }
  }

  // Strategy 1: Find a JSON object inside the text (handling markdown fences or embedded JSON)
  const jsonMatch = rawText.match(/\{[\s\S]*?"translatedTitle"[\s\S]*?\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { translatedTitle?: string; translatedExcerpt?: string }
      if (parsed.translatedTitle && parsed.translatedTitle !== '...') {
        title = String(parsed.translatedTitle).trim()
      }
      if (parsed.translatedExcerpt && parsed.translatedExcerpt !== '...') {
        excerpt = String(parsed.translatedExcerpt).trim()
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // Strategy 2: Extract from tags like [TITLE] / [EXCERPT]
  if (!title) {
    const titleMatch = rawText.match(
      /(?:\[TITLE\]|\[TIÊU ĐỀ\]|Title:)\s*([^\n\r]+(?:\n[^\n\r[]+)*?)(?=\s*\[(?:EXCERPT|TÓM TẮT)\]|\s*Excerpt:|$)/i,
    )
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim()
    }
  }

  if (!excerpt) {
    const excerptMatch = rawText.match(/(?:\[EXCERPT\]|\[TÓM TẮT\]|Excerpt:)\s*([\s\S]+?)$/i)
    if (excerptMatch && excerptMatch[1]) {
      excerpt = excerptMatch[1].trim()
    }
  }

  // Strategy 3: Clean prompt artifacts if instructions were echoed
  if (title) {
    title = title
      .replace(/^[\s\S]*?\[(?:TITLE|TIÊU ĐỀ)\]:\s*/i, '')
      .replace(/^Keep HTML if present\.\s*/gi, '')
      .replace(/^Return JSON:[\s\S]*?\{[\s\S]*?\}\s*/gi, '')
      .replace(/\[(?:EXCERPT|TÓM TẮT)\]:[\s\S]*$/i, '')
      .replace(/^[:\s-]+/, '')
      .replace(/^["']|["']$/g, '')
      .trim()
  }

  if (excerpt) {
    excerpt = excerpt
      .replace(/^[\s\S]*?\[(?:EXCERPT|TÓM TẮT)\]:\s*/i, '')
      .replace(/^[:\s-]+/, '')
      .replace(/^["']|["']$/g, '')
      .trim()
  }

  // Fallback if title still looks empty or has instruction remnants
  if (!title && originalTitle) {
    const cleanLines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith('{') &&
          !l.startsWith('}') &&
          !l.includes('Return JSON') &&
          !l.includes('Keep HTML') &&
          !l.includes('translatedTitle'),
      )
    title = cleanLines[0]?.replace(/^[:\s-]+/, '') || ''
  }

  return { title, excerpt }
}

// ─── Translation worker ──────────────────────────────────────────────────

export async function runTranslationWorker(
  articleId: number,
  langCode: string,
  langName: string,
  targetStatus: 'ai_draft' | 'published' = 'ai_draft',
) {
  const db = getDb()
  logInfo({ event: 'translation.job_started', articleId, langCode })
  try {
    // Fetch article content
    const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1)
    if (!article) {
      await updateTranslationStatus(db, articleId, langCode, {
        status: 'failed',
        errorMessage: 'Bài viết không tồn tại.',
      })
      return
    }

    // Budget check
    const budgetResult = await checkBudget(db, 'translation_article')
    if (!budgetResult.allowed) {
      await updateTranslationStatus(db, articleId, langCode, {
        status: 'failed',
        errorMessage: 'Ngân sách AI đã hết.',
      })
      return
    }

    // Translate title + excerpt (single call)
    await updateTranslationStatus(db, articleId, langCode, { progress: 0 })

    let translatedTitle = ''
    let translatedExcerpt = ''

    if (article.title || article.excerpt) {
      const titlePrompt = `Bạn là biên dịch viên báo chí chuyên nghiệp.
Hãy dịch chính xác tiêu đề và đoạn tóm tắt bài viết sau sang ${langName}.
YÊU CẦU BẮT BUỘC:
1. Văn phong báo chí trang trọng, chính xác.
2. CHỈ TRẢ VỀ DUY NHẤT một JSON object hợp lệ theo định dạng:
{"translatedTitle": "tiêu đề đã dịch", "translatedExcerpt": "tóm tắt đã dịch"}
3. TUYỆT ĐỐI KHÔNG lặp lại đề bài, không dịch câu lệnh, không thêm markdown ngoài JSON.

TIÊU ĐỀ GỐC:
${article.title ?? ''}

TÓM TẮT GỐC:
${article.excerpt ?? ''}`

      let titleResult = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        titleResult = await callAi('translation_article', {
          prompt: titlePrompt,
          userId: null,
        })
        if (titleResult.ok && titleResult.text) break
        if (attempt < 3) {
          logWarn({ event: 'translation.title_retry', articleId, langCode, attempt })
          await delay(attempt * 1500)
        }
      }

      if (titleResult?.ok && titleResult?.text) {
        const parsed = parseTitleAndExcerpt(titleResult.text, article.title || '', article.excerpt || '')
        translatedTitle = parsed.title
        translatedExcerpt = parsed.excerpt
      }

      // Safe fallback: if title is still missing while original exists
      if (!translatedTitle && article.title) {
        try {
          const directTitleRes = await callAi('translation_article', {
            prompt: `Dịch tiêu đề tin tức sau sang ${langName}. CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH, không thêm dấu ngoặc kép hay giải thích:\n\n${article.title}`,
            userId: null,
          })
          if (directTitleRes.ok && directTitleRes.text) {
            translatedTitle = directTitleRes.text.trim().replace(/^["']|["']$/g, '')
          }
        } catch {
          // Keep whatever we have
        }
      }

      // Safe fallback: if excerpt is still missing while original exists
      if (!translatedExcerpt && article.excerpt) {
        try {
          const directExcerptRes = await callAi('translation_article', {
            prompt: `Dịch đoạn tóm tắt tin tức sau sang ${langName}. CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH, không thêm dấu ngoặc kép hay giải thích:\n\n${article.excerpt}`,
            userId: null,
          })
          if (directExcerptRes.ok && directExcerptRes.text) {
            translatedExcerpt = directExcerptRes.text.trim().replace(/^["']|["']$/g, '')
          }
        } catch {
          // Keep whatever we have
        }
      }
    }
    await updateTranslationStatus(db, articleId, langCode, {
      progress: 10,
      title: translatedTitle,
      excerpt: translatedExcerpt,
    })

    // Chunk and translate content
    const content = article.content ?? ''
    if (!content.trim()) {
      // No content — just save title + excerpt
      await updateTranslationStatus(db, articleId, langCode, {
        status: targetStatus,
        progress: 100,
        totalChunks: 0,
        currentChunk: 0,
        completedAt: new Date(),
      })
      logInfo({ event: 'translation.job_completed', articleId, langCode, totalChunks: 0 })
      return
    }

    const chunks = chunkHtml(content)
    const totalChunks = chunks.length

    await updateTranslationStatus(db, articleId, langCode, {
      totalChunks,
      currentChunk: 0,
      progress: 10,
    })

    const translatedChunks: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const chunkPrompt = `Dịch đoạn ${i + 1}/${totalChunks} của một bài viết sang ${langName}.
Yêu cầu:
1. Chuẩn xác thuật ngữ pháp lý và hành chính.
2. Giữ nguyên 100% các thẻ HTML (<p>, <strong>, <em>, <a>, <img>, <ul>, <ol>, <li>, <h2>, <h3>, <table>...) — chỉ dịch phần văn bản bên trong.
3. Giữ nguyên cấu trúc HTML.

[NỘI DUNG GỐC]:
${chunk.html}`

      let chunkResult = null
      let attempts = 0
      const MAX_RETRIES = 3
      while (attempts < MAX_RETRIES) {
        attempts++
        chunkResult = await callAi('translation_article', {
          prompt: chunkPrompt,
          userId: null,
        })
        if (chunkResult.ok && chunkResult.text) break

        if (attempts < MAX_RETRIES) {
          logWarn({ event: 'translation.chunk_retry', articleId, langCode, chunk: i + 1, attempt: attempts })
          await delay(attempts * 2000)
        }
      }

      if (!chunkResult?.ok || !chunkResult?.text) {
        // Save partial and mark failed after 3 retries
        await updateTranslationStatus(db, articleId, langCode, {
          status: 'failed',
          errorMessage: `Lỗi dịch đoạn ${i + 1}/${totalChunks} (đã thử lại ${MAX_RETRIES} lần): ${chunkResult?.errorMessage || 'AI không phản hồi.'}`,
          currentChunk: i,
          progress: 10 + Math.round((i / totalChunks) * 90),
          content: translatedChunks.join(''),
        })
        logWarn({ event: 'translation.chunk_failed_after_retries', articleId, langCode, chunk: i + 1, total: totalChunks })
        return
      }

      translatedChunks.push(chunkResult.text.trim())

      const progress = 10 + Math.round(((i + 1) / totalChunks) * 90)
      await updateTranslationStatus(db, articleId, langCode, {
        currentChunk: i + 1,
        progress,
      })

      logInfo({ event: 'translation.chunk_completed', articleId, langCode, chunk: i + 1, total: totalChunks })
    }

    // All chunks done — assemble and save
    await db
      .update(articleTranslations)
      .set({
        content: translatedChunks.join(''),
        status: targetStatus,
        progress: 100,
        currentChunk: totalChunks,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(articleTranslations.articleId, articleId),
          eq(articleTranslations.langCode, langCode),
        ),
      )

    logInfo({ event: 'translation.job_completed', articleId, langCode, totalChunks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateTranslationStatus(db, articleId, langCode, {
      status: 'failed',
      errorMessage: message.slice(0, 512),
    })
    logWarn({ event: 'translation.job_failed', articleId, langCode, error: message })
  }
}

async function updateTranslationStatus(
  db: Database,
  articleId: number,
  langCode: string,
  updates: Partial<{
    status: string
    progress: number
    currentChunk: number
    totalChunks: number
    errorMessage: string | null
    completedAt: Date
    title: string
    excerpt: string
    content: string
  }>,
) {
  await db
    .update(articleTranslations)
    .set(updates)
    .where(
      and(
        eq(articleTranslations.articleId, articleId),
        eq(articleTranslations.langCode, langCode),
      ),
    )
}
