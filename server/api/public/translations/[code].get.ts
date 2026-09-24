import { getDb } from '../../../utils/db'
import { languages } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { getTranslationsForPublic } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  const db = getDb()

  const [lang] = await db.select().from(languages).where(eq(languages.code, code)).limit(1)

  if (!lang || !lang.isActive) {
    return { ok: true, translations: {} }
  }

  const translations = await getTranslationsForPublic(code, db)

  return { ok: true, translations }
})
