import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { startUniversalAutoTranslate } from '../../../services/universal-translation'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const targetLangs = Array.isArray(body?.targetLangs)
    ? body.targetLangs.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean)
    : []

  if (targetLangs.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn ít nhất một ngôn ngữ đích.' })
  }

  // A whole number ≥ 0; 0 is "every published article" (the tab's "Tất cả bài viết").
  // `Number(...)` used to turn "abc" and -1 into "no limit": the whole archive, times
  // every language, each a paid run of the article worker (FINDING-R6-7).
  const articlesLimit = body?.articlesLimit === undefined ? 20 : body.articlesLimit
  if (typeof articlesLimit !== 'number' || !Number.isInteger(articlesLimit) || articlesLimit < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Số bài viết cần dịch phải là số nguyên từ 0 trở lên (0 = tất cả).' })
  }

  const result = await startUniversalAutoTranslate(adminUser, targetLangs, {
    includeUi: body?.includeUi !== false,
    includeBlocks: body?.includeBlocks !== false,
    includeArticles: body?.includeArticles !== false,
    articlesLimit,
    publishImmediately: Boolean(body?.publishImmediately),
  })

  // "Một lượt khác đang chạy" là một lời TỪ CHỐI: 409 + câu của dịch vụ. Trước đây là 200
  // `{ ok: false }`, và tab "Dịch toàn cục" báo nó bằng toast xanh "thành công"
  // (tests/universal-translate-refusal-behavior.test.ts).
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: result.message })
  return result
})
