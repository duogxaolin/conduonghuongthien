import { asc, eq } from 'drizzle-orm'
import { getDb } from '../../utils/db'
import { languages } from '../../db/schema'
import { reportPublicReadFailure } from '../../utils/public-read-failure'

export default defineEventHandler(async (event) => {
  try {
    const db = getDb()
    const rows = await db
      .select({
        code: languages.code,
        name: languages.name,
        nativeName: languages.nativeName,
        isDefault: languages.isDefault,
        displayOrder: languages.displayOrder,
      })
      .from(languages)
      .where(eq(languages.isActive, true))
      .orderBy(asc(languages.displayOrder), asc(languages.id))

    return { ok: true, items: rows }
  } catch (error) {
    // `useI18n` bắt lỗi và lùi về danh sách ngôn ngữ mặc định — giữ nguyên như
    // trước; khác biệt là lượt hỏng nay có log và không mang mã 200.
    reportPublicReadFailure(event, 'public.languages_failed', error)
    return { ok: false, items: [] }
  }
})
