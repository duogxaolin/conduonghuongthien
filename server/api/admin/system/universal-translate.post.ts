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

  const result = await startUniversalAutoTranslate(adminUser, targetLangs, {
    includeUi: body?.includeUi !== false,
    includeBlocks: body?.includeBlocks !== false,
    includeArticles: body?.includeArticles !== false,
    articlesLimit: body?.articlesLimit !== undefined ? Number(body.articlesLimit) : 20,
    publishImmediately: Boolean(body?.publishImmediately),
  })

  // "Một lượt khác đang chạy" là một lời TỪ CHỐI: 409 + câu của dịch vụ. Trước đây là 200
  // `{ ok: false }`, và tab "Dịch toàn cục" báo nó bằng toast xanh "thành công"
  // (tests/universal-translate-refusal-behavior.test.ts).
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: result.message })
  return result
})
