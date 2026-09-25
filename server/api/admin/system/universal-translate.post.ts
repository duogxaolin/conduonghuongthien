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

  return result
})
