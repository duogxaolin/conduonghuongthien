import { getDb } from '../../../utils/db'
import { categories } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const query = getQuery(event)
  const typeFilter = String(query.type || '').trim()

  const db = getDb()

  // Fetch all categories (with optional type filter)
  const all = await db
    .select()
    .from(categories)
    .where(typeFilter ? eq(categories.type, typeFilter) : undefined)
    .orderBy(asc(categories.displayOrder), asc(categories.id))

  // Build map for parent name lookup
  const idToName: Record<number, string> = {}
  for (const cat of all) {
    idToName[cat.id] = cat.name
  }

  const result = all.map((cat) => ({
    ...cat,
    parentName: cat.parentId ? (idToName[cat.parentId] ?? null) : null,
  }))

  return { ok: true, items: result }
})
