import { getDb } from '../../../utils/db'
import { homeSections } from '../../../db/schema'
import { asc } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'home_sections', 'read')

  const db = getDb()
  const sections = await db
    .select()
    .from(homeSections)
    .orderBy(asc(homeSections.displayOrder))

  return { ok: true, sections }
})
