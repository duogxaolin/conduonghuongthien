import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { triggerTranslation } from '../../../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const langCode = String(body?.langCode || '').trim().toLowerCase()
  if (!langCode) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  await triggerTranslation(adminUser, id, langCode)
  return { ok: true, message: 'Đã bắt đầu dịch. Vui lòng đợi.' }
})
