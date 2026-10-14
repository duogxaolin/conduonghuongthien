import { getDb } from '../../utils/db'
import { reportPublicReadFailure } from '../../utils/public-read-failure'
import { homeSections } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  try {
    const db = getDb()
    const sections = await db
      .select()
      .from(homeSections)
      .where(eq(homeSections.isVisible, true))
      .orderBy(asc(homeSections.displayOrder))

    return { ok: true, sections }
  } catch (error) {
    reportPublicReadFailure(event, 'public.home_sections_failed', error)
    return { ok: false, sections: [] }
  }
})
