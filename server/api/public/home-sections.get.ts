import { getDb } from '../../utils/db'
import { homeSections } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler(async () => {
  try {
    const db = getDb()
    const sections = await db
      .select()
      .from(homeSections)
      .where(eq(homeSections.isVisible, true))
      .orderBy(asc(homeSections.displayOrder))

    return { ok: true, sections }
  } catch (err: any) {
    return { ok: false, sections: [] }
  }
})
