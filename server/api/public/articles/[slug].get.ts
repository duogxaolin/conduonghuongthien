import { sanitizeHtml } from '../../../utils/sanitize-html'
import { plainTextField, withPlainTextFields } from '../../../utils/decode-html-entities'
import {
  findPublishedArticleBySlug,
  findReadableArticleTranslation,
  listPublishedTranslationLangs,
} from '../../../services/public-articles-queries'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Invalid slug' })

  const query = getQuery(event)
  const cookieLang = getCookie(event, 'cdkt_lang')?.trim().toLowerCase() || ''
  const lang = (typeof query.lang === 'string' ? query.lang.trim().toLowerCase() : '') || cookieLang

  try {
    const found = await findPublishedArticleBySlug(slug)

    if (!found) {
      throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại hoặc chưa xuất bản.' })
    }
    // Imported excerpts carry HTML entities (`Ng&agrave;y`); decoded here, not in the DB.
    // Thân bài là `v-html` ở trang bài viết và trang in: lọc lúc đọc, một lần ở đây, để cả ba lối trả về
    // bên dưới (tiếng Việt, "chưa có bản dịch", bản dịch rỗng lùi về thân gốc) cùng nhận bản đã lọc.
    // Hàng nhập từ trang cũ hay ghi ngoài app chưa từng qua lớp lọc lúc ghi (CHANGELOG § 103).
    const article = {
      ...withPlainTextFields(found),
      content: found.content == null ? null : sanitizeHtml(found.content),
    }

    // If a language is requested, check for a published translation
    if (lang && lang !== 'vi') {
      const translation = await findReadableArticleTranslation(article.id, lang)

      if (translation && translation.title && translation.title.trim()) {
        return {
          ok: true,
          article: {
            ...article,
            title:    plainTextField(translation.title) ?? article.title,
            excerpt:  plainTextField(translation.excerpt) ?? article.excerpt,
            // Lọc lúc đọc: bản dịch ghi trước khi có lớp lọc lúc ghi vẫn nằm trong DB.
            content:  translation.content == null ? article.content : sanitizeHtml(translation.content),
            translatedFrom: 'vi',
          },
        }
      }

      // No published translation — list available languages
      const availableRows = await listPublishedTranslationLangs(article.id)

      return {
        ok: true,
        article,
        availableTranslations: availableRows.map((r) => r.langCode),
      }
    }

    return { ok: true, article }
  } catch (err: unknown) {
    if ((err as { statusCode?: number })?.statusCode === 404) throw err
    throw createError({ statusCode: 500, statusMessage: 'Lỗi máy chủ' })
  }
})
