import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { updateTranslation } from '../../../../../services/article-translations'

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

  await updateTranslation(adminUser, id, lang, {
    title: typeof body?.title === 'string' ? body.title : undefined,
    excerpt: typeof body?.excerpt === 'string' ? body.excerpt : undefined,
    content: typeof body?.content === 'string' ? body.content : undefined,
  })

  return { ok: true }
})
