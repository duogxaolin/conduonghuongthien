import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../../utils/permissions'
import { setTranslationStatus } from '../../../../../../services/article-translations'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'update')

  const id = Number(getRouterParam(event, 'id'))
  const lang = getRouterParam(event, 'lang')
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }
  if (!lang) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const status = String(body?.status || '')
  if (!['published', 'reviewed', 'ai_draft'].includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Trạng thái không hợp lệ.' })
  }

  await setTranslationStatus(adminUser, id, lang, status as 'published' | 'reviewed' | 'ai_draft')
  return { ok: true }
})
