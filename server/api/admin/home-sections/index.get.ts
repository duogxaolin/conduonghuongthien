import { getDb } from '../../../utils/db'
import { homeSections } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'home_sections', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()
  const sections = await db
    .select()
    .from(homeSections)
    .orderBy(asc(homeSections.displayOrder))

  return { ok: true, sections }
})
