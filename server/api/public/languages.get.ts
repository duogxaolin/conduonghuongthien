import { asc, eq } from 'drizzle-orm'
import { getDb } from '../../utils/db'
import { languages } from '../../db/schema'

export default defineEventHandler(async () => {
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
  } catch {
    return { ok: false, items: [] }
  }
})
