import { requireResourcePermission } from '../../../utils/permissions'
import { readTranslationStatsCounts } from '../../../services/admin-articles-queries'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  // Published articles, active non-vi languages, translations (not failed) of published articles per
  // language, AI translations awaiting review — services/admin-articles-queries.ts.
  const { totalPublished, activeLangs, translationCounts, aiPendingRow } = await readTranslationStatsCounts()

  const total = Number(totalPublished?.total) || 0

  const countMap = new Map(translationCounts.map((c) => [c.langCode, Number(c.count) || 0]))

  const items = activeLangs.map((l) => {
    const translated = countMap.get(l.code) || 0
    return {
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
      translated,
      missing: Math.max(0, total - translated),
    }
  })

  // Bản dịch AI chưa xuất bản (ai_draft/reviewed) — badge trên nút "Xuất bản toàn bộ".
  const aiPendingTranslations = Number(aiPendingRow?.count) || 0

  return {
    ok: true,
    totalArticles: total,
    languages: items,
    aiPendingTranslations,
  }
})
