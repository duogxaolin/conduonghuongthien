import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { bulkPublishAiTranslations } from '../../../services/article-translations'

/**
 * Xuất bản toàn bộ bản dịch AI chưa xuất bản (status `ai_draft`/`reviewed`).
 * Bỏ qua `translating` (đang dịch) và `failed` (lỗi) để không phá dòng chạy.
 * Tuỳ chọn lọc theo `langCode`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'update')

  const body = await readBody(event).catch(() => ({}))
  const langCode = typeof body?.langCode === 'string' && body.langCode.trim()
    ? body.langCode.trim().toLowerCase()
    : null

  const result = await bulkPublishAiTranslations(adminUser, langCode)

  if (result.published === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Không có bản dịch AI nào sẵn sàng xuất bản (tất cả đang dịch hoặc đã lỗi).',
    })
  }

  return {
    ok: true,
    published: result.published,
    skipped: result.skipped,
    skippedTranslating: result.skippedTranslating,
    skippedFailed: result.skippedFailed,
  }
})
