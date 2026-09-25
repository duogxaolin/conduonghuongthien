import { createError } from 'h3'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { articleTranslations } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'news', 'read')

  const id = Number(getRouterParam(event, 'id'))
  const lang = getRouterParam(event, 'lang')
  if (!id || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID bài viết không hợp lệ.' })
  }
  if (!lang) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  const db = getDb()
  const [translation] = await db
    .select()
    .from(articleTranslations)
    .where(
      and(
        eq(articleTranslations.articleId, id),
        eq(articleTranslations.langCode, lang),
      ),
    )
    .limit(1)

  if (!translation) {
    throw createError({ statusCode: 404, statusMessage: 'Bản dịch không tồn tại.' })
  }

  return { ok: true, translation }
})
