import { getDb } from '../../../utils/db'
import { contentTypes, categories, articles } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { asc, eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'categories', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()

  const all = await db
    .select()
    .from(contentTypes)
    .orderBy(asc(contentTypes.displayOrder), asc(contentTypes.id))

  // Count categories + articles per type (by slug) for the admin usage badges
  const catCounts = await db
    .select({ type: categories.type, c: count() })
    .from(categories)
    .groupBy(categories.type)
  const artCounts = await db
    .select({ type: articles.type, c: count() })
    .from(articles)
    .groupBy(articles.type)

  const catMap: Record<string, number> = {}
  for (const r of catCounts) catMap[r.type] = Number(r.c)
  const artMap: Record<string, number> = {}
  for (const r of artCounts) artMap[r.type] = Number(r.c)

  const items = all.map((ct) => ({
    ...ct,
    categoryCount: catMap[ct.slug] ?? 0,
    articleCount: artMap[ct.slug] ?? 0,
  }))

  return { ok: true, items }
})
